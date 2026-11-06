-- ═══════════════════════════════════════════════════════════════════════════
-- 0030  bound the roll, and only pay for it on a late repeat
--
-- Two things 0029 got wrong, found in review before anything depended on them.
--
-- `rolled_due` scanned a reach that grew with the interval, so a yearly rule
-- with a large interval walked hundreds of thousands of days. It is capped at
-- eight years now.
--
-- `digest_items` called it for every open task the user has, once per list,
-- and the window test read only the rolled date, which the index cannot serve.
-- A roll only moves a date later, so the stored date bounds the rolled one:
-- the window test checks the stored column first, and the call is made only
-- for a repeat whose stored date has passed. The nudge gets the same cheap
-- predicate ahead of the call.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rolled_due(p_task public.tasks, p_local date)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s        public.task_series;
  v_anchor date;
  v_reach  integer;
  v_day    date;
begin
  if p_task.series_id is null or p_task.due_date is null or p_task.due_date >= p_local then
    return p_task.due_date;
  end if;

  select * into s from public.task_series where id = p_task.series_id and deleted_at is null;
  if s.id is null or s.catchup_policy <> 'skip_to_future' then
    return p_task.due_date;
  end if;

  v_anchor := coalesce(p_task.occurrence_date, p_task.due_date);
  if v_anchor >= p_local then
    return p_task.due_date;
  end if;

  if s.anchor_mode = 'completion_date' then
    v_day := p_local;
  else
    -- As far as `stepOnce` itself looks for one step, so a rule the client can
    -- step the server can find.
    -- Capped at eight years. Uncapped, a yearly rule's reach grew with its
    -- interval, and "every 365 years" scanned a million days per task per
    -- digest. Nothing past eight years is a missed repeat anybody is waiting on.
    v_reach := least(2928, case s.freq
      when 'daily'   then greatest(1, s.interval)
      when 'weekly'  then 7 * greatest(1, s.interval) * 2 + 7
      when 'monthly' then 31 * 24 * greatest(1, s.interval)
      else 366 * 8 * greatest(1, s.interval)
    end);
    for i in 0 .. v_reach - 1 loop
      if public.repeat_occurs_on(s, v_anchor, p_local + i) then
        v_day := p_local + i;
        exit;
      end if;
    end loop;
    if v_day is null then
      return p_task.due_date;
    end if;
  end if;

  if s.ends_mode = 'on_date' and s.ends_on is not null and v_day > s.ends_on then
    return p_task.due_date;
  end if;
  return v_day;
end;
$$;

create or replace function public.digest_items(
  p_user            uuid,
  p_from            date,
  p_to              date,
  p_include_planned boolean,
  p_limit           integer default 25,
  p_exclude         uuid[] default '{}',
  p_local           date default null
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(item order by due_date nulls last, due_time nulls first, sort_key), '[]'::jsonb)
    from (
      select r.due_date, t.due_time, t.sort_key,
             jsonb_build_object(
               'id', t.id, 'title', t.title,
               'dueDate', r.due_date, 'dueTime', t.due_time,
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
        cross join lateral (
          -- Only a late repeat can move, so only a late repeat pays for the call.
          select case when p_local is null or t.series_id is null or t.due_date >= p_local
                      then t.due_date
                      else public.rolled_due(t, p_local) end as due_date
        ) r
       where t.user_id = p_user
         and t.deleted_at is null
         and t.archived_at is null
         and t.status not in ('done', 'cancelled')
         and t.id <> all (coalesce(p_exclude, '{}'::uuid[]))
         and (
           -- A roll only moves a date later, so a row stored past the window
           -- cannot roll into it. Checked on the stored column first, where the
           -- index is.
           (t.due_date <= p_to
             and (p_from is null or r.due_date >= p_from)
             and r.due_date <= p_to)
           or (p_include_planned and t.planned_for is not null
                and t.planned_for >= coalesce(p_from, t.planned_for)
                and t.planned_for <= p_to)
         )
       -- Inside the limit, not outside it. See 0028.
       order by r.due_date nulls last, t.due_time nulls first, t.sort_key
       limit p_limit
    ) s;
$$;

create or replace function public.enqueue_overdue_nudges(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  insert into public.reminder_deliveries
    (user_id, kind, scheduled_at, local_date, dedupe_key)
  select u.user_id, 'overdue_nudge', p_now, l.local_date,
         'on:' || u.user_id || ':' || l.local_date
    from public.user_settings u
    cross join lateral (
      select (p_now at time zone u.timezone)::date as local_date,
             (p_now at time zone u.timezone)::time as local_time
    ) l
   where public.notifiable(u.user_id)
     and u.nudge_enabled
     and l.local_time >= u.nudge_time
     and exists (
       select 1 from public.tasks t
        where t.user_id = u.user_id
          and t.deleted_at is null
          and t.archived_at is null
          and t.status not in ('done', 'cancelled')
          and t.due_date < l.local_date
          and public.rolled_due(t, l.local_date) < l.local_date
     )
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rolled_due(public.tasks, date) from public, anon, authenticated;
revoke all on function public.digest_items(uuid, date, date, boolean, integer, uuid[], date)
  from public, anon, authenticated;
revoke all on function public.enqueue_overdue_nudges(timestamptz) from public, anon, authenticated;
