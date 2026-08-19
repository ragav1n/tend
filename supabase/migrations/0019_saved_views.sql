-- ═══════════════════════════════════════════════════════════════════════════
-- 0019  saved views
--
-- A view is a filter with a name. The filter itself is jsonb rather than a
-- column per field, because the client is the only thing that reads it: no
-- query here joins on "priority floor", and a column set would need a migration
-- every time the builder learns a new axis. The shape is enforced in
-- lib/views/filter.ts, which is testable, rather than in a check constraint,
-- which would reject an older client's rows after a newer one shipped.
--
-- Windows are stored as words, never dates. A view called "This week" that
-- resolved to the week it was created is a view that quietly stops being true,
-- so `{"due":"week"}` is resolved against the day it is opened.
--
-- `sort_key` is collate "C" like every other one in this schema, so Postgres
-- ordering matches the client's JavaScript sort of the same rows.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.saved_views (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,

  name           text not null check (length(name) between 1 and 80),
  -- One of the Phosphor names the client knows. Free text on purpose: a check
  -- constraint here would mean shipping an icon needs a migration.
  icon           text not null default 'Funnel',
  filter         jsonb not null default '{}'::jsonb,
  sort           text not null default 'manual' check (sort in (
                   'manual', 'due', 'priority', 'created', 'title'
                 )),
  -- Whether the sidebar carries it. Everything else lives on the views screen.
  pinned         boolean not null default true,
  sort_key       text not null default 'a0' collate "C",

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,

  unique (user_id, id)
);

alter table public.saved_views enable row level security;

create policy saved_views_select on public.saved_views
  for select to authenticated using (user_id = (select auth.uid()));

create policy saved_views_insert on public.saved_views
  for insert to authenticated with check (user_id = (select auth.uid()));

-- No delete policy, for the same reason tasks has none: a client tombstones and
-- the purge is a service_role job.
create policy saved_views_update on public.saved_views
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger saved_views_stamp
  before insert or update on public.saved_views
  for each row execute function public.stamp_sync_columns();

create index saved_views_sync_idx on public.saved_views (user_id, row_version);
create index saved_views_order_idx on public.saved_views (user_id, sort_key)
  where deleted_at is null;

-- ── Sync ───────────────────────────────────────────────────────────────────

/** saved_views joins the writable list. sync_push needs nothing else: it builds
 *  every statement from information_schema for the named table. */
create or replace function public.sync_writable_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'tasks', 'projects', 'tags', 'areas', 'task_series', 'task_tags',
    'user_settings', 'focus_sessions', 'activity_log', 'saved_views'
  ]::text[];
$$;

/**
 * Everything that changed above the cursor, oldest first.
 *
 * Reproduced whole from 0018 with one arm added, because `create or replace`
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
    union all
    select 'activity_log', l.row_version, to_jsonb(l) - 'user_id'
      from public.activity_log l where l.user_id = v_uid and l.row_version > p_cursor
    union all
    select 'saved_views', v.row_version, to_jsonb(v) - 'user_id'
      from public.saved_views v where v.user_id = v_uid and v.row_version > p_cursor
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
