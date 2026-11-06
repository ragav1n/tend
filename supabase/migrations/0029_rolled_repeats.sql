-- ═══════════════════════════════════════════════════════════════════════════
-- 0029  a missed repeat is today's task in the email too
--
-- The client rolls an open occurrence whose day has passed onto the day it
-- belongs to now (`rollForward` in lib/recurrence.ts), so "Stretch, every day"
-- missed yesterday sits on Today rather than in Overdue. It does that when a
-- device opens the app. The 07:00 digest runs before anyone has, against a row
-- still dated yesterday, so it listed the task as overdue and the evening nudge
-- fired for it.
--
-- The stored row stays as it is: the device still writes the roll. The digest
-- and the nudge read the date the row is about to have, `rolled_due`, which
-- applies the same rule the client does:
--
--   * only an open occurrence of a live series whose catchup policy is
--     'skip_to_future'. 'keep_backlog' exists to keep the gap visible;
--   * a completion-anchored series lands on today;
--   * a due-anchored series lands on its first scheduled day on or after
--     today, so a missed weekly Monday waits for next Monday;
--   * a landing past `ends_on` leaves the task overdue, as the client does.
--
-- `repeat_occurs_on` is `stepOnce` turned into a predicate. Two quirks of the
-- stepper are carried over on purpose, because agreeing with the client matters
-- more here than being tidy: monthly and yearly steps start in the next period,
-- so a rule only ever lands on the earliest resolvable day of a period, and a
-- day past the end of a month does not clamp.
-- ═══════════════════════════════════════════════════════════════════════════

-- A month day, where -1 means the last one and a day the month lacks is null.
create or replace function public.resolve_month_day(p_year integer, p_month integer, p_day integer)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_day = -1 then (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date
    when p_day between 1 and extract(day from make_date(p_year, p_month, 1) + interval '1 month - 1 day')
      then make_date(p_year, p_month, p_day)
  end;
$$;

create or replace function public.repeat_occurs_on(s public.task_series, p_anchor date, p_day date)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_interval integer := greatest(1, s.interval);
  v_gap      integer;
  v_y        integer := extract(year from p_day);
  v_m        integer := extract(month from p_day);
begin
  if p_day <= p_anchor then
    return false;
  end if;

  if s.freq = 'daily' then
    return (p_day - p_anchor) % v_interval = 0;
  end if;

  if s.freq = 'weekly' then
    if not extract(isodow from p_day)::smallint = any (
         case when cardinality(s.byday) > 0 then s.byday
              else array[extract(isodow from p_anchor)::smallint] end) then
      return false;
    end if;
    -- Weeks between the two Mondays, which is what keeps "every other Tuesday"
    -- on the same fortnight.
    v_gap := ((p_day - (extract(isodow from p_day)::integer - 1))
            - (p_anchor - (extract(isodow from p_anchor)::integer - 1))) / 7;
    return v_gap % v_interval = 0;
  end if;

  if s.freq = 'monthly' then
    v_gap := (v_y * 12 + v_m)
           - (extract(year from p_anchor)::integer * 12 + extract(month from p_anchor)::integer);
    if v_gap <= 0 or v_gap % v_interval <> 0 then
      return false;
    end if;

    if s.month_week <> 0 and cardinality(s.byday) > 0 then
      if extract(isodow from p_day)::smallint <> s.byday[1] then
        return false;
      end if;
      if s.month_week = -1 then
        return extract(month from p_day + 7) <> v_m;
      end if;
      return ceil(extract(day from p_day) / 7.0) = s.month_week;
    end if;

    return p_day = (
      select min(public.resolve_month_day(v_y, v_m, d))
        from unnest(case when cardinality(s.bymonthday) > 0 then s.bymonthday
                         else array[extract(day from p_anchor)::smallint] end) d
    );
  end if;

  -- yearly
  v_gap := v_y - extract(year from p_anchor)::integer;
  if v_gap <= 0 or v_gap % v_interval <> 0 then
    return false;
  end if;
  return p_day = (
    select min(public.resolve_month_day(v_y, m, d))
      from unnest(case when cardinality(s.bymonth) > 0 then s.bymonth
                       else array[extract(month from p_anchor)::smallint] end) m,
           unnest(case when cardinality(s.bymonthday) > 0 then s.bymonthday
                       else array[extract(day from p_anchor)::smallint] end) d
  );
end;
$$;

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
    v_reach := case s.freq
      when 'daily'   then greatest(1, s.interval)
      when 'weekly'  then 7 * greatest(1, s.interval) * 2 + 7
      when 'monthly' then 31 * 24 * greatest(1, s.interval)
      else 366 * 8 * greatest(1, s.interval)
    end;
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

-- A new trailing parameter makes a second overload rather than replacing the
-- first, and two overloads make every short call ambiguous. Dropped first, as
-- 0010 did.
drop function if exists public.digest_items(uuid, date, date, boolean, integer, uuid[]);

-- `p_local` null reads the stored date, which is what every caller got before.
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
          select case when p_local is null then t.due_date
                      else public.rolled_due(t, p_local) end as due_date
        ) r
       where t.user_id = p_user
         and t.deleted_at is null
         and t.archived_at is null
         and t.status not in ('done', 'cancelled')
         and t.id <> all (coalesce(p_exclude, '{}'::uuid[]))
         and (
           (r.due_date is not null
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

-- Unchanged from 0013 but for passing the local date to each list.
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
  v_overdue := public.digest_items(v_d.user_id, null, v_local - 1, false, 25, '{}', v_local);
  v_seen := public.digest_ids(v_overdue);

  v_today := public.digest_items(v_d.user_id, v_local, v_local, true, 25, v_seen, v_local);
  v_seen := v_seen || public.digest_ids(v_today);

  v_soon := public.digest_items(v_d.user_id, v_local + 1, v_local + v_ahead, false, 25, v_seen, v_local);

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

-- Unchanged from 0015 but for reading the rolled date.
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
          and public.rolled_due(t, l.local_date) < l.local_date
     )
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.resolve_month_day(integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.repeat_occurs_on(public.task_series, date, date)
  from public, anon, authenticated;
revoke all on function public.rolled_due(public.tasks, date) from public, anon, authenticated;
revoke all on function public.digest_items(uuid, date, date, boolean, integer, uuid[], date)
  from public, anon, authenticated;
revoke all on function public.reminder_payload(uuid) from public, anon, authenticated;
revoke all on function public.enqueue_overdue_nudges(timestamptz) from public, anon, authenticated;
