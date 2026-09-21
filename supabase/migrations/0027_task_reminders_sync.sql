-- ── "Remind me two days before" ────────────────────────────────────────────
--
-- `task_reminders` has existed since 0008. The reminder pipeline already reads
-- it and already prefers an explicit reminder over the implicit one derived
-- from `reminder_lead_minutes`; there is a test in `lib/reminders/pipeline.test.ts`
-- that has been asserting so since the day it was written.
--
-- What it never had was a way in. It was absent from `sync_writable_tables()`,
-- had no Dexie table and no UI, so no client could create a row and the whole
-- feature sat there working and unreachable. This migration is the missing
-- half: two lines of list, and the pull arm that goes with them.
--
-- The offset is signed minutes against the due instant, negative for before,
-- which is why a thesis deadline can carry "two days before" while the global
-- lead stays at zero. One global number cannot say that, and per-task is the
-- only shape that can.

create or replace function public.sync_writable_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'tasks', 'projects', 'tags', 'areas', 'task_series', 'task_tags',
    'user_settings', 'focus_sessions', 'activity_log', 'saved_views',
    'terms', 'courses', 'course_components', 'feeds', 'task_reminders'
  ]::text[];
$$;

-- And the pull learns to read it back, or it would be writable and invisible.

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
    union all
    select 'terms', tm.row_version, to_jsonb(tm) - 'user_id'
      from public.terms tm where tm.user_id = v_uid and tm.row_version > p_cursor
    union all
    select 'courses', c.row_version, to_jsonb(c) - 'user_id'
      from public.courses c where c.user_id = v_uid and c.row_version > p_cursor
    union all
    select 'course_components', cc.row_version, to_jsonb(cc) - 'user_id'
      from public.course_components cc
       where cc.user_id = v_uid and cc.row_version > p_cursor
    union all
    select 'feeds', f.row_version, to_jsonb(f) - 'user_id'
      from public.feeds f where f.user_id = v_uid and f.row_version > p_cursor
    union all
    select 'course_events', ce.row_version, to_jsonb(ce) - 'user_id'
      from public.course_events ce
       where ce.user_id = v_uid and ce.row_version > p_cursor
    union all
    select 'task_reminders', r.row_version, to_jsonb(r) - 'user_id'
      from public.task_reminders r
       where r.user_id = v_uid and r.row_version > p_cursor
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
