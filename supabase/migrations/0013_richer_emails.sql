-- ═══════════════════════════════════════════════════════════════════════════
-- 0013  more in the envelope
--
-- The emails could only ever say what `reminder_payload` froze into the jsonb,
-- and that was a title, a date, a time, a priority and a project name. A digest
-- built from that reads like a list of strings. Everything the app shows next to
-- a task on screen was missing: its tags, how far its subtasks have got, how long
-- it was meant to take, which colour its project is.
--
-- So the shape grows before the templates do:
--
--   * digest_items carries projectColor, tags, subtasks, estimate, waiting and
--     repeats alongside what it already had.
--   * The task_reminder branch carries the same set, so one task on its own is
--     described as well as one task in a list.
--   * The summary branch adds completedToday, a seven day completion series and
--     a streak, which is what turns a weekly review from two numbers into a week.
--
-- Two other things move while the shape is open:
--
--   * The weekly review looks seven days ahead rather than three. "This week" that
--     stops on Wednesday is not this week.
--   * The streak anchors on the last day with a completion, not on today, so a
--     digest that arrives at 07:00 before anything is done reports the run through
--     yesterday rather than zero.
--
-- Everything here is additive. A delivery claimed before this migration and
-- retried after it renders from the old frozen payload, so every new field is
-- optional on the way out.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * A task's tag names, three at most.
 *
 * Three because a chip row that wraps to a second line in a 600px email costs
 * more than the fourth tag is worth. Names only: a tag colour is chosen against
 * the app's dark surface, and most of them fail contrast as text on white.
 */
create or replace function public.task_tag_names(p_task uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(name), '[]'::jsonb)
    from (
      select g.name
        from public.task_tags tt
        join public.tags g on g.id = tt.tag_id and g.user_id = tt.user_id
       where tt.task_id = p_task
         and g.deleted_at is null
       order by g.sort_key, g.name
       limit 3
    ) s;
$$;

/**
 * How far a task's subtasks have got, or null when it has none.
 *
 * Null rather than a zero pair, because the template asks "is there progress to
 * show" and a `{done: 0, total: 0}` answers yes.
 */
create or replace function public.subtask_progress(p_task uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when count(*) = 0 then null else
           jsonb_build_object(
             'done', count(*) filter (where c.status = 'done'),
             'total', count(*))
         end
    from public.tasks c
   where c.parent_task_id = p_task
     and c.deleted_at is null
     and c.status <> 'cancelled';
$$;

/**
 * Open tasks in a date window, as jsonb items.
 *
 * Same window rules as 0010: `p_from` null means no lower bound, planned items
 * join when asked for, `p_exclude` keeps one task off two lists. What changed is
 * how much each item says about itself.
 *
 * The two correlated subqueries cost a pair of index lookups per row against a
 * list capped at 25, which is cheaper than the joins and the grouping it would
 * take to gather them set-wise.
 */
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
       limit p_limit
    ) s;
$$;

/**
 * Everything the renderer needs for one delivery, as one jsonb value.
 *
 * Still frozen at claim time, so a retry after a crash renders the same email
 * even if the task moved since.
 */
create or replace function public.reminder_payload(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_d       public.reminder_deliveries;
  v_local   date;
  v_tz      text;
  v_ahead   integer;
  v_overdue jsonb;
  v_today   jsonb;
  v_soon    jsonb;
  v_seen    uuid[];
  v_by_day  jsonb;
  v_streak  integer;
  v_result  jsonb;
begin
  select * into v_d from public.reminder_deliveries where id = p_id;
  if v_d.id is null then
    return null;
  end if;

  select timezone into v_tz from public.user_settings where user_id = v_d.user_id;
  v_local := coalesce(v_d.local_date, (now() at time zone v_tz)::date);

  if v_d.kind = 'task_reminder' then
    select jsonb_build_object(
             'kind', v_d.kind,
             'task', jsonb_build_object(
               'id', t.id, 'title', t.title, 'notes', left(t.notes, 500),
               'dueDate', t.due_date, 'dueTime', t.due_time,
               'priority', t.priority, 'project', p.name,
               'projectColor', p.color,
               'waiting', t.status = 'waiting',
               'repeats', t.series_id is not null,
               'estimate', t.estimate_minutes,
               'tags', public.task_tag_names(t.id),
               'subtasks', public.subtask_progress(t.id))
           )
      into v_result
      from public.tasks t
      left join public.projects p on p.id = t.project_id
     -- A task closed or deleted since the row was enqueued yields no payload,
     -- and the claim reads that as "cancel this rather than send it". The drain
     -- normally removes the row first; this covers the tick that ran out of
     -- budget before it got there.
     where t.id = v_d.task_id
       and t.deleted_at is null
       and t.archived_at is null
       and t.status not in ('done', 'cancelled');

    return v_result;
  end if;

  -- A weekly review reads the week. Everything else looks three days out, which
  -- is as far as a morning digest can look without becoming a backlog.
  v_ahead := case when v_d.kind = 'weekly_review' then 7 else 3 end;

  -- Built in order, each list excluding what the ones before it took.
  v_overdue := public.digest_items(v_d.user_id, null, v_local - 1, false, 25);
  v_seen := public.digest_ids(v_overdue);

  v_today := public.digest_items(v_d.user_id, v_local, v_local, true, 25, v_seen);
  v_seen := v_seen || public.digest_ids(v_today);

  v_soon := public.digest_items(v_d.user_id, v_local + 1, v_local + v_ahead, false, 25, v_seen);

  -- One pass over the week's completions, spread back over seven dates so a day
  -- nobody finished anything still gets a zero and the chart keeps its shape.
  with done as (
    select (t.completed_at at time zone v_tz)::date as day, count(*) as n
      from public.tasks t
     where t.user_id = v_d.user_id
       and t.deleted_at is null
       and t.completed_at >= (v_local - 6)::timestamp at time zone v_tz
       and t.completed_at <  (v_local + 1)::timestamp at time zone v_tz
     group by 1
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('date', d.day, 'count', coalesce(done.n, 0)) order by d.day), '[]'::jsonb)
    into v_by_day
    from (select generate_series(v_local - 6, v_local, interval '1 day')::date as day) d
    left join done on done.day = d.day;

  -- The run of consecutive days ending at the last day anything was finished.
  -- Ranked descending, the leading contiguous run is exactly the set where the
  -- date has fallen as far as the row number has climbed; the first gap breaks
  -- that for every row after it. Anchoring on the last completion rather than on
  -- today is what stops a 07:00 digest reporting a broken streak every morning.
  with days as (
    select distinct (t.completed_at at time zone v_tz)::date as day
      from public.tasks t
     where t.user_id = v_d.user_id
       and t.deleted_at is null
       and t.completed_at is not null
       and t.completed_at >= (v_local - 365)::timestamp at time zone v_tz
       and t.completed_at <  (v_local + 1)::timestamp at time zone v_tz
  ),
  ranked as (
    select day, row_number() over (order by day desc) as rn, max(day) over () as last_day
      from days
  )
  select count(*)
    into v_streak
    from ranked
   where last_day >= v_local - 1
     and day = last_day - (rn - 1)::integer;

  return jsonb_build_object(
    'kind', v_d.kind,
    'localDate', v_local,
    'today', v_today,
    'overdue', v_overdue,
    'dueSoon', v_soon,
    'completedByDay', v_by_day,
    'streak', v_streak,
    'completedToday', (
      select count(*) from public.tasks t
       where t.user_id = v_d.user_id
         and t.deleted_at is null
         and t.completed_at >= v_local::timestamp at time zone v_tz
         and t.completed_at <  (v_local + 1)::timestamp at time zone v_tz
    ),
    'completedThisWeek', (
      select count(*) from public.tasks t
       where t.user_id = v_d.user_id
         and t.deleted_at is null
         and t.completed_at >= (v_local - 6)::timestamp at time zone v_tz
    ),
    'openTotal', (
      select count(*) from public.tasks t
       where t.user_id = v_d.user_id
         and t.deleted_at is null
         and t.archived_at is null
         and t.status not in ('done', 'cancelled')
    )
  );
end;
$$;

revoke all on function public.digest_items(uuid, date, date, boolean, integer, uuid[])
  from public, anon, authenticated;
revoke all on function public.reminder_payload(uuid) from public, anon, authenticated;
revoke all on function public.task_tag_names(uuid) from public, anon, authenticated;
revoke all on function public.subtask_progress(uuid) from public, anon, authenticated;
