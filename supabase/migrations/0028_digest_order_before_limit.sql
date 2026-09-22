-- ═══════════════════════════════════════════════════════════════════════════
-- 0028  order the digest before cutting it off
--
-- `digest_items` has taken the wrong twenty-five tasks since 0008. The limit
-- sat inside a subquery with no `order by`, and the ordering sat outside it in
-- the `jsonb_agg`:
--
--     select jsonb_agg(item order by due_date, due_time, sort_key)
--       from (select ... from tasks where ... limit p_limit) s;
--
-- So Postgres was free to return any twenty-five rows the predicate matched,
-- and the sort then arranged that arbitrary set. Past twenty-five qualifying
-- tasks the digest could drop what is due today and keep what is due in three
-- weeks, and it would look right either way: the email is always in date
-- order, because the outer sort never stopped working. Nothing about the output
-- says which rows were dropped.
--
-- Two things made it reachable rather than theoretical. A Canvas import lands
-- forty-eight assignments at once, and subtasks carrying their own deadlines
-- are now items in their own right, so the window that a digest asks about
-- holds more than it used to.
--
-- The fix is one clause in one place: order inside the subquery, before the cut.
-- The outer sort stays, because `jsonb_agg` guarantees its own order only when
-- told to, and because leaving it makes the two agree by construction.
--
-- Carried through 0010 and 0013 unchanged, which is how it survived three
-- reviews: each migration replaced the function to add fields and copied the
-- shape it was given.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.digest_items(
  p_user            uuid,
  p_from            date,
  p_to              date,
  p_include_planned boolean,
  p_limit           integer default 25,
  p_exclude         uuid[] default '{}'
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(item order by due_date nulls last, due_time nulls first, sort_key), '[]'::jsonb)
    from (
      select t.due_date, t.due_time, t.sort_key,
             jsonb_build_object(
               'id', t.id, 'title', t.title,
               'dueDate', t.due_date, 'dueTime', t.due_time,
               'priority', t.priority, 'project', p.name,
               'projectColor', p.color,
               'planned', t.planned_for is not null and t.planned_for <= p_to,
               'waiting', t.status = 'waiting',
               'repeats', t.series_id is not null,
               'estimate', t.estimate_minutes,
               'tags', public.task_tag_names(t.id),
               'subtasks', public.subtask_progress(t.id)
             ) as item
        from public.tasks t
        left join public.projects p on p.id = t.project_id
       where t.user_id = p_user
         and t.deleted_at is null
         and t.archived_at is null
         and t.status not in ('done', 'cancelled')
         and t.id <> all (coalesce(p_exclude, '{}'::uuid[]))
         and (
           (t.due_date is not null
             and (p_from is null or t.due_date >= p_from)
             and t.due_date <= p_to)
           or (p_include_planned and t.planned_for is not null
                and t.planned_for >= coalesce(p_from, t.planned_for)
                and t.planned_for <= p_to)
         )
       -- Inside the limit, not outside it. See the migration header.
       order by t.due_date nulls last, t.due_time nulls first, t.sort_key
       limit p_limit
    ) s;
$$;

-- `create or replace` keeps the existing ACL, so the revoke from 0013 still
-- stands. Restated because a function this pipeline calls being callable by any
-- signed-in session is the failure `lib/sync/migrations.test.ts` exists to
-- catch, and restating a revoke costs nothing.
revoke all on function public.digest_items(uuid, date, date, boolean, integer, uuid[])
  from public, anon, authenticated;
