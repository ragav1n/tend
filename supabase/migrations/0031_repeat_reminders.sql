-- ═══════════════════════════════════════════════════════════════════════════
-- 0031  a repeat's reminder comes every day it is due, device or no device
--
-- A task's reminder was scheduled from its stored due date, and for a repeat
-- that date only moves on when a device opens the app and rolls it. So
-- "Stretch, every day, 7am" reminded on Monday, and if nobody opened the app on
-- Tuesday the row still said Monday and nothing was scheduled for Tuesday or
-- any day after.
--
-- The server does not write the roll into the row. Every write bumps that
-- field's version, and a push carrying an older base drops the field, so a
-- server roll would silently discard a due date changed offline on another
-- device. Scheduling is read-only, so this stays read-only too:
--
--   * `recompute_task_notifications` schedules for the stored day and, for a
--     repeat, each of the next three days `rolled_due` says it would sit on.
--     Completing the task already clears its pending rows, and the next
--     occurrence schedules its own, so a finished day leaves nothing behind;
--   * `reconcile_notifications` takes late repeats into its nightly sweep,
--     which is what moves that window on while nobody is around;
--   * `reminder_payload` says the day the reminder is for, not the stored one.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.recompute_task_notifications(p_task uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_owner uuid;
  v_count integer := 0;
begin
  select user_id into v_owner from public.tasks where id = p_task;
  if v_owner is null then
    return 0;
  end if;
  if v_uid is not null and v_owner <> v_uid then
    raise exception 'that task belongs to somebody else' using errcode = '42501';
  end if;

  delete from public.reminder_deliveries
   where task_id = p_task and kind = 'task_reminder' and status = 'pending';

  insert into public.reminder_deliveries
    (user_id, kind, task_id, reminder_id, scheduled_at, local_date, dedupe_key)
  select c.user_id, 'task_reminder', c.task_id, c.reminder_id, c.at, c.local_date, c.dedupe_key
    from (
      select
        t.user_id,
        t.id as task_id,
        r.id as reminder_id,
        public.apply_quiet_hours(
          ((days.day + coalesce(t.due_time, u.all_day_reminder_time))
            at time zone u.timezone)
            + make_interval(mins => coalesce(r.offset_minutes, -u.reminder_lead_minutes)),
          u.timezone, u.quiet_hours_enabled, u.quiet_start, u.quiet_end
        ) as at,
        days.day as local_date,
        case when r.id is null then 'ti:' || t.id else 'tr:' || r.id end as reminder_key
        from public.tasks t
        join public.user_settings u on u.user_id = t.user_id
        left join public.task_reminders r
          on r.task_id = t.id and r.deleted_at is null
        -- The stored day, and for a repeat each of the next three days it would
        -- sit on if still undone then. Without the second half a daily task
        -- nobody opened the app for got Monday's reminder and nothing after,
        -- because only a device moves the stored date on.
        cross join lateral (
          select t.due_date as day
          union
          select d::date
            from generate_series(
                   (now() at time zone u.timezone)::date,
                   (now() at time zone u.timezone)::date + 2,
                   interval '1 day') d
           where t.series_id is not null
             and public.rolled_due(t, d::date) = d::date
        ) days
       where t.id = p_task
         and t.deleted_at is null
         and t.archived_at is null
         and t.status not in ('done', 'cancelled')
         and t.due_date is not null
         and public.notifiable(u.user_id)
         and u.reminders_enabled
    ) s
    cross join lateral (
      -- Spelled in UTC so the key cannot depend on the session's TimeZone.
      select s.*, s.reminder_key || ':' ||
             to_char(s.at at time zone 'UTC', 'YYYYMMDDHH24MI') as dedupe_key
    ) c
   where c.at > now()
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.reconcile_notifications(
  p_horizon_days integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rebuilt   integer := 0;
  v_cancelled integer := 0;
begin
  -- A pending reminder for work that is already done or gone. The trigger normally
  -- catches this; a restart is how it gets missed.
  update public.reminder_deliveries d
     set status = 'cancelled', reason = 'task closed', updated_at = now()
   where d.status = 'pending'
     and d.kind = 'task_reminder'
     and exists (
       select 1 from public.tasks t
        where t.id = d.task_id
          and (t.deleted_at is not null
               or t.archived_at is not null
               or t.status in ('done', 'cancelled'))
     );

  get diagnostics v_cancelled = row_count;

  -- The rebuild is idempotent, so running it over rows that are already correct
  -- costs a dedupe_key conflict and nothing else.
  select count(*) into v_rebuilt
    from (
      select public.recompute_task_notifications(t.id)
        from public.tasks t
        join public.user_settings u on u.user_id = t.user_id
       where t.deleted_at is null
         and t.archived_at is null
         and t.status not in ('done', 'cancelled')
         and t.due_date is not null
         -- One day back, because "yesterday 23:00" is still ahead of now() for
         -- anybody far enough west.
         and (t.due_date between current_date - 1 and current_date + p_horizon_days
              -- A late repeat still has days ahead of it, and this sweep is what
              -- moves its three-day window on while no device is around to.
              or (t.series_id is not null and t.due_date < current_date - 1))
         and public.notifiable(u.user_id)
         and u.reminders_enabled
    ) s;

  perform public.record_cron_heartbeat('reconcile_notifications', jsonb_build_object(
    'rebuilt', v_rebuilt, 'cancelled', v_cancelled
  ));

  return jsonb_build_object('rebuilt', v_rebuilt, 'cancelled', v_cancelled);
end;
$$;

-- Unchanged from 0029 but for the task's due date.
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
               'dueDate', public.rolled_due(t, v_local), 'dueTime', t.due_time,
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

-- `recompute_task_notifications` keeps the grant 0008 gave it: a signed-in
-- session may call it for its own tasks, and the function checks the owner.
-- `create or replace` leaves that ACL as it was.
revoke all on function public.reconcile_notifications(integer) from public, anon, authenticated;
revoke all on function public.reminder_payload(uuid) from public, anon, authenticated;
