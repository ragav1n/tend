-- ═══════════════════════════════════════════════════════════════════════════
-- 0016  focus sessions
--
-- The timer needs somewhere to put what it measured, and the answer has to be
-- the same on every device: "45 minutes of focus this week" that counts only
-- the laptop is a number nobody trusts twice.
--
-- started_at and ended_at are timestamptz, which makes this the second table in
-- the schema allowed absolute instants, after reminder_deliveries.scheduled_at.
-- That is not an inconsistency with the wall-clock rule on tasks: a task due
-- "tomorrow 9am" is due at 9am wherever you stand, while a session that began
-- at 14:03 began at one instant that a flight does not move.
--
-- The session row is written when the timer starts rather than when it ends, so
-- a tab that dies mid-session leaves a record of the part that happened.
-- focused_seconds is the client's accumulation with paused time excluded, which
-- is why it is stored rather than derived from the two timestamps.
--
-- No outcome column. Whether a session ran its length is (focused_seconds
-- against planned_minutes), and a column that restates a comparison is a column
-- that can disagree with it.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.focus_sessions (
  id              uuid primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- Null for a session that is not about one task, which is most of them at the
  -- start of an hour.
  task_id         uuid,

  started_at      timestamptz not null,
  -- Null while the session is running.
  ended_at        timestamptz,
  planned_minutes integer not null default 25 check (planned_minutes between 1 and 240),
  -- Time actually spent, paused time excluded. Capped at a day so a clock jump
  -- or a session left running overnight cannot poison a week's total.
  focused_seconds integer not null default 0 check (focused_seconds between 0 and 86400),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  row_version     bigint not null default 0,
  field_versions  jsonb  not null default '{}'::jsonb,

  -- Composite tenancy key, so a session cannot be attached to another account's
  -- task. Cascade rather than set null: the composite form would have to null
  -- user_id too, and a session about work that has been purged is history about
  -- nothing.
  foreign key (user_id, task_id) references public.tasks (user_id, id) on delete cascade,
  unique (user_id, id)
);

alter table public.focus_sessions enable row level security;

create policy focus_sessions_select on public.focus_sessions
  for select to authenticated using (user_id = (select auth.uid()));

create policy focus_sessions_insert on public.focus_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));

-- No delete policy, for the same reason tasks has none: a client tombstones and
-- the purge is a service_role job.
create policy focus_sessions_update on public.focus_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger focus_sessions_stamp
  before insert or update on public.focus_sessions
  for each row execute function public.stamp_sync_columns();

create index focus_sessions_sync_idx on public.focus_sessions (user_id, row_version);
-- The review screen asks for one window at a time, newest first.
create index focus_sessions_started_idx on public.focus_sessions (user_id, started_at desc)
  where deleted_at is null;

-- ── Sync ───────────────────────────────────────────────────────────────────

/** focus_sessions joins the writable list. sync_push needs nothing else: it
 *  builds every insert and update from information_schema for the named table. */
create or replace function public.sync_writable_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'tasks', 'projects', 'tags', 'areas', 'task_series', 'task_tags',
    'user_settings', 'focus_sessions'
  ]::text[];
$$;

/**
 * Everything that changed above the cursor, oldest first.
 *
 * Reproduced whole from 0003 with one arm added, because `create or replace`
 * has no partial form. Nothing else in it has changed.
 */
create or replace function public.sync_pull(
  p_cursor bigint default 0,
  p_limit  integer default 500
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_limit  integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_rows   jsonb;
  v_taken  integer;
  v_next   bigint;
  v_more   boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  with combined as (
    select 'tasks' as tbl, t.row_version,
           (to_jsonb(t) - 'search_vector' - 'parent_depth' - 'user_id')
             || jsonb_build_object('tag_ids', coalesce(
                  (select jsonb_agg(tt.tag_id order by tt.tag_id)
                     from public.task_tags tt where tt.task_id = t.id),
                  '[]'::jsonb)) as row
      from public.tasks t
     where t.user_id = v_uid and t.row_version > p_cursor
    union all
    select 'projects', p.row_version, to_jsonb(p) - 'user_id'
      from public.projects p where p.user_id = v_uid and p.row_version > p_cursor
    union all
    select 'tags', g.row_version, to_jsonb(g) - 'user_id'
      from public.tags g where g.user_id = v_uid and g.row_version > p_cursor
    union all
    select 'areas', a.row_version, to_jsonb(a) - 'user_id'
      from public.areas a where a.user_id = v_uid and a.row_version > p_cursor
    union all
    select 'task_series', s.row_version, to_jsonb(s) - 'user_id'
      from public.task_series s where s.user_id = v_uid and s.row_version > p_cursor
    union all
    select 'user_settings', u.row_version, to_jsonb(u) - 'user_id'
      from public.user_settings u where u.user_id = v_uid and u.row_version > p_cursor
    union all
    select 'focus_sessions', f.row_version, to_jsonb(f) - 'user_id'
      from public.focus_sessions f where f.user_id = v_uid and f.row_version > p_cursor
  ),
  -- One extra row is fetched purely to answer "is there more", which is
  -- cheaper and less racy than a second count over the same predicate.
  page as (
    select * from combined order by row_version limit v_limit + 1
  ),
  kept as (
    select * from page order by row_version limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('table', tbl, 'row', row) order by row_version), '[]'::jsonb),
    count(*),
    max(row_version),
    (select count(*) from page) > v_limit
  into v_rows, v_taken, v_next, v_more
  from kept;

  return jsonb_build_object(
    'rows',    v_rows,
    -- Holding the old cursor when a page is empty matters: advancing to the
    -- table maximum would skip rows a concurrent transaction is about to commit
    -- at a lower version.
    'cursor',  coalesce(v_next, p_cursor),
    'hasMore', coalesce(v_more, false),
    'count',   coalesce(v_taken, 0)
  );
end;
$$;

revoke all on function public.sync_pull(bigint, integer) from public;
grant execute on function public.sync_pull(bigint, integer) to authenticated;
