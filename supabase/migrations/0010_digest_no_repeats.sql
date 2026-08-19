-- ═══════════════════════════════════════════════════════════════════════════
-- 0010  one task, one line
--
-- A task due yesterday and planned for today appeared twice in the same digest:
-- once under Late and again under Today, both times labelled "yesterday". Adding
-- it from the Today view is what puts planned_for on it, so this is the ordinary
-- case rather than an edge one.
--
-- The three lists were each built from their own predicate with nothing shared
-- between them. `today` takes anything planned for today whatever its due date,
-- and `dueSoon` takes the next three days, so a task planned today and due Friday
-- doubled up as well.
--
-- Now the lists are built in order and each one excludes what the ones before it
-- already claimed: Late, then Today, then Next few days. Late wins because a task
-- that is already overdue is not news about today.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.digest_items(uuid, date, date, boolean, integer);

/**
 * Open tasks in a date window, as jsonb items.
 *
 * `p_from` null means no lower bound, which is what overdue needs. Planned items
 * join the window when asked for, because a Today list is a plan rather than a
 * pile of deadlines and the digest is that list. `p_exclude` is what keeps one
 * task off two lists.
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
               'planned', t.planned_for is not null and t.planned_for <= p_to
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
  v_overdue jsonb;
  v_today   jsonb;
  v_soon    jsonb;
  v_seen    uuid[];
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
               'priority', t.priority, 'project', p.name)
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

  -- Built in order, each list excluding what the ones before it took.
  v_overdue := public.digest_items(v_d.user_id, null, v_local - 1, false, 25);
  v_seen := public.digest_ids(v_overdue);

  v_today := public.digest_items(v_d.user_id, v_local, v_local, true, 25, v_seen);
  v_seen := v_seen || public.digest_ids(v_today);

  v_soon := public.digest_items(v_d.user_id, v_local + 1, v_local + 3, false, 25, v_seen);

  return jsonb_build_object(
    'kind', v_d.kind,
    'localDate', v_local,
    'today', v_today,
    'overdue', v_overdue,
    'dueSoon', v_soon,
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

/** The ids in a list, so the next list can leave them alone. */
create or replace function public.digest_ids(p_items jsonb)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg((item ->> 'id')::uuid), '{}'::uuid[])
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item;
$$;

revoke all on function public.digest_items(uuid, date, date, boolean, integer, uuid[])
  from public, anon, authenticated;
revoke all on function public.reminder_payload(uuid) from public, anon, authenticated;
