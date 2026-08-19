-- ═══════════════════════════════════════════════════════════════════════════
-- 0015  a notification is a reason to schedule one
--
-- 0014 taught the claim to choose channels, and stopped there. The claim can only
-- choose for a row that exists, and every function that decides whether a row
-- exists asked `email_enabled`. So for the person 0014 was written for, somebody
-- who turns email off and turns notifications on, nothing was ever enqueued and
-- there was nothing to choose. The promise in that migration's header was half
-- true in the code and entirely false in production.
--
-- The mistake underneath it is worth naming: `email_enabled` was doing two jobs.
-- It answered "do you want to be told" and "how should we tell you", and 0014
-- split the second job out without touching the first. This finishes the split.
-- `notifiable()` answers the first question, and the per-kind switches
-- (`reminders_enabled`, `digest_enabled`, `nudge_enabled`,
-- `weekly_review_enabled`) keep answering "do you want this kind at all", which a
-- subscription is no reason to override.
--
-- The five functions below are the 0008 and 0009 bodies with one predicate
-- changed each. They are reproduced whole because `create or replace` has no
-- other shape, which is also how 0014 nearly dropped 0011's staleness check.
--
-- One trigger is new. Turning email off deletes pending task reminders, so
-- turning notifications on afterwards would leave somebody with no reminders
-- until the nightly reconciler rebuilt them. A subscription appearing or
-- disappearing now queues the same user-wide recompute a settings change does,
-- which is the mechanism that already exists for exactly this.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Whether this person has asked to be told anything at all.
 *
 * Email is a channel and so is a subscribed browser. Either one is consent to
 * schedule; neither one overrides a per-kind switch.
 *
 * `stable` rather than `immutable`: both inputs are rows that change. Definer and
 * revoked, like every other function in the pipeline, and reachable anyway from
 * the definer functions that call it because inside those the current role is the
 * owner.
 */
create or replace function public.notifiable(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           (select u.email_enabled from public.user_settings u where u.user_id = p_user),
           false
         )
      or exists (select 1 from public.push_subscriptions s where s.user_id = p_user);
$$;

revoke all on function public.notifiable(uuid) from public, anon, authenticated;

-- ── What may be scheduled ──────────────────────────────────────────────────

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
          ((t.due_date + coalesce(t.due_time, u.all_day_reminder_time))
            at time zone u.timezone)
            + make_interval(mins => coalesce(r.offset_minutes, -u.reminder_lead_minutes)),
          u.timezone, u.quiet_hours_enabled, u.quiet_start, u.quiet_end
        ) as at,
        t.due_date as local_date,
        case when r.id is null then 'ti:' || t.id else 'tr:' || r.id end as reminder_key
        from public.tasks t
        join public.user_settings u on u.user_id = t.user_id
        left join public.task_reminders r
          on r.task_id = t.id and r.deleted_at is null
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

-- ── The periodic enqueues ──────────────────────────────────────────────────

create or replace function public.enqueue_daily_digests(p_now timestamptz default now())
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
  select u.user_id, 'daily_digest', p_now, l.local_date,
         'dd:' || u.user_id || ':' || l.local_date
    from public.user_settings u
    cross join lateral (
      select (p_now at time zone u.timezone)::date as local_date,
             (p_now at time zone u.timezone)::time as local_time
    ) l
   where public.notifiable(u.user_id)
     and u.digest_enabled
     and l.local_time >= u.digest_time
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
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
     )
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.enqueue_weekly_reviews(p_now timestamptz default now())
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
  select u.user_id, 'weekly_review', p_now, l.local_date,
         'wr:' || u.user_id || ':' || to_char(l.local_date, 'IYYY-IW')
    from public.user_settings u
    cross join lateral (
      select (p_now at time zone u.timezone)::date as local_date,
             (p_now at time zone u.timezone)::time as local_time
    ) l
   where public.notifiable(u.user_id)
     and u.weekly_review_enabled
     and extract(isodow from l.local_date) = u.weekly_review_day
     and l.local_time >= u.weekly_review_time
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── The nightly repair ─────────────────────────────────────────────────────

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
         and t.due_date between current_date - 1 and current_date + p_horizon_days
         and public.notifiable(u.user_id)
         and u.reminders_enabled
    ) s;

  perform public.record_cron_heartbeat('reconcile_notifications', jsonb_build_object(
    'rebuilt', v_rebuilt, 'cancelled', v_cancelled
  ));

  return jsonb_build_object('rebuilt', v_rebuilt, 'cancelled', v_cancelled);
end;
$$;

/**
 * A subscription appearing or disappearing changes what should be scheduled.
 *
 * Same body as `queue_user_recompute`, and a separate function because that one
 * reads `new.user_id` and this fires on delete as well, where there is no `new`.
 * The pending rows go rather than being rebuilt here: doing that work inside the
 * request that enabled notifications is exactly what the queue exists to avoid.
 */
create or replace function public.queue_push_recompute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  delete from public.reminder_deliveries
   where user_id = v_user and kind = 'task_reminder' and status = 'pending';

  insert into public.notification_recompute_queue (user_id, task_id)
  values (v_user, null)
  on conflict do nothing;

  return null;
end;
$$;

drop trigger if exists push_subscriptions_queue_notifications on public.push_subscriptions;
create trigger push_subscriptions_queue_notifications
  after insert or delete on public.push_subscriptions
  for each row execute function public.queue_push_recompute();
