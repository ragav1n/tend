-- ═══════════════════════════════════════════════════════════════════════════
-- 0008  the reminder pipeline
--
-- Postgres decides who gets an email and when. Vercel only renders and sends.
-- That split is deliberate: Hobby cron runs at most once a day, so the minute
-- tick has to live in the database, and once the tick is here the scheduling may
-- as well be set-based SQL next to the data instead of a loop over HTTP.
--
-- The shape:
--
--   pg_cron every minute
--     └─ notifications_tick()
--          ├─ reap claims stuck longer than five minutes
--          ├─ drain notification_recompute_queue, bounded to 500
--          ├─ enqueue digests, overdue nudges, weekly reviews
--          └─ POST /api/cron/reminders, but only when something is due
--
-- Only POSTing when there is work is what keeps function invocations near zero
-- on a quiet day rather than burning 1,440 of them.
--
-- Four decisions worth defending:
--
--   * Timezone conversion happens in exactly one place, here, at row generation.
--     Tasks hold wall clock, user_settings holds an IANA name, and
--     `(due_date + due_time) at time zone tz` reads the naive value as local in
--     that zone. At send time the predicate is `scheduled_at <= now()`, a plain
--     UTC comparison against a partial index, with zero timezone logic left.
--
--   * dedupe_key carries a unique index and is derived only from inputs, so a
--     recompute that runs five times for one offline batch still yields one row.
--     The digest key uses the local calendar date, so a DST fall-back where
--     01:30 happens twice cannot produce two digests in one day.
--
--   * Digests use a catch-up predicate, never equality. `local_time = digest_time`
--     breaks on spring-forward, where an 02:30 digest time does not exist and the
--     user silently gets nothing. "At or past digest_time and none sent for this
--     local date" is DST-proof in both directions and self-healing across a
--     missed cron minute.
--
--   * Triggers only mark work into an unlogged queue. Retitling 200 tasks in an
--     offline batch must not do 200 recomputes inside the sync transaction, and
--     the tick is at most 60 seconds behind, which is close enough for a reminder
--     that a person set minutes earlier.
--
-- pg_cron, pg_net and Vault are absent from PGlite, so every reference to them is
-- guarded at runtime rather than at parse time. That is what lets the whole file
-- run in the test harness.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Settings the pipeline reads ────────────────────────────────────────────
-- These ride the existing sync channel: user_settings is pulled whole and 0007
-- made it writable, so a new column needs nothing on the wire.

alter table public.user_settings
  add column if not exists email_enabled boolean not null default true,
  -- Per-task reminders at the due time. Off means only digests and nudges.
  add column if not exists reminders_enabled boolean not null default true,
  -- Minutes before the due instant. Positive, because "remind me 10 minutes
  -- before" is how people say it. task_reminders.offset_minutes is signed.
  add column if not exists reminder_lead_minutes integer not null default 0
    check (reminder_lead_minutes between 0 and 1440),
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_start time not null default '22:00',
  add column if not exists quiet_end time not null default '07:00',
  add column if not exists nudge_enabled boolean not null default true,
  add column if not exists nudge_time time not null default '18:00'
    check (nudge_time between '04:00' and '20:00'),
  add column if not exists weekly_review_enabled boolean not null default true,
  -- ISO day of week, 1 Monday through 7 Sunday.
  add column if not exists weekly_review_day smallint not null default 7
    check (weekly_review_day between 1 and 7),
  add column if not exists weekly_review_time time not null default '17:00'
    check (weekly_review_time between '04:00' and '20:00'),
  -- A runaway recurring series cannot burn the month's quota in an afternoon.
  add column if not exists max_reminder_emails_per_day integer not null default 20
    check (max_reminder_emails_per_day between 0 and 50),
  -- Bumping this revokes every unsubscribe link already in somebody's inbox.
  add column if not exists email_token_version integer not null default 1;

-- ── Explicit per-task reminders ────────────────────────────────────────────
-- Created by a future UI. Recompute already reads them, and a task with none
-- gets one implicit reminder from the settings above, which is what makes
-- reminders work today without a new sync channel.

create table if not exists public.task_reminders (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  task_id        uuid not null,
  -- Signed minutes relative to the due instant. Negative is before.
  offset_minutes integer not null default 0
                   check (offset_minutes between -20160 and 20160),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  row_version    bigint not null default 0,
  field_versions jsonb  not null default '{}'::jsonb,

  unique (user_id, id),
  foreign key (user_id, task_id) references public.tasks (user_id, id) on delete cascade
);

create unique index if not exists task_reminders_offset_idx
  on public.task_reminders (task_id, offset_minutes)
  where deleted_at is null;

create index if not exists task_reminders_cursor_idx
  on public.task_reminders (user_id, row_version);

alter table public.task_reminders enable row level security;

drop policy if exists task_reminders_select on public.task_reminders;
create policy task_reminders_select on public.task_reminders
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists task_reminders_insert on public.task_reminders;
create policy task_reminders_insert on public.task_reminders
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists task_reminders_update on public.task_reminders;
create policy task_reminders_update on public.task_reminders
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists task_reminders_stamp on public.task_reminders;
create trigger task_reminders_stamp
  before insert or update on public.task_reminders
  for each row execute function public.stamp_sync_columns();

-- ── Deliveries ─────────────────────────────────────────────────────────────

create table if not exists public.reminder_deliveries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null check (kind in
                  ('task_reminder', 'daily_digest', 'overdue_nudge', 'weekly_review')),
  -- Null for anything that is not about one task.
  task_id       uuid,
  -- Null when the reminder is the implicit one from user_settings.
  reminder_id   uuid,
  scheduled_at  timestamptz not null,
  -- The user's local calendar date, which is what the digest dedupes on.
  local_date    date,
  status        text not null default 'pending' check (status in
                  ('pending', 'claimed', 'sent', 'skipped', 'failed', 'cancelled')),
  attempts      integer not null default 0,
  max_attempts  integer not null default 3,
  -- Deterministic and derived only from inputs, so recompute is free to run
  -- again and the unique index collapses the duplicates.
  dedupe_key    text not null unique,
  -- Frozen at claim time so attempt two renders byte-identical content even if
  -- the task changed in between.
  payload       jsonb,
  reason        text,
  claimed_at    timestamptz,
  sent_at       timestamptz,
  provider_message_id text,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  foreign key (user_id, task_id) references public.tasks (user_id, id) on delete cascade
);

-- The claim predicate, and the only index it needs. Partial, so the pending set
-- stays tiny however much history piles up behind it.
create index if not exists reminder_deliveries_due_idx
  on public.reminder_deliveries (scheduled_at)
  where status = 'pending';

create index if not exists reminder_deliveries_task_idx
  on public.reminder_deliveries (task_id) where status = 'pending';

create index if not exists reminder_deliveries_user_idx
  on public.reminder_deliveries (user_id, created_at desc);

alter table public.reminder_deliveries enable row level security;

-- Read only, and read only your own. Every write goes through a function that
-- runs as the owner or as service_role.
drop policy if exists reminder_deliveries_select on public.reminder_deliveries;
create policy reminder_deliveries_select on public.reminder_deliveries
  for select to authenticated using (user_id = (select auth.uid()));

-- ── The recompute queue ────────────────────────────────────────────────────
-- Unlogged: losing it on a crash costs one tick, and the nightly reconciler
-- repairs anything missed. A task_id of null means "everything for this user",
-- which is what a timezone change produces.

create unlogged table if not exists public.notification_recompute_queue (
  user_id   uuid not null,
  task_id   uuid,
  queued_at timestamptz not null default now(),
  unique nulls not distinct (user_id, task_id)
);

alter table public.notification_recompute_queue enable row level security;

-- ── Email bookkeeping ──────────────────────────────────────────────────────

create table if not exists public.email_suppressions (
  email      text primary key,
  reason     text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.email_events (
  id         bigserial primary key,
  delivery_id uuid references public.reminder_deliveries (id) on delete set null,
  provider_message_id text,
  type       text not null,
  at         timestamptz not null default now(),
  raw        jsonb
);

-- Global rather than per user, because the cap it defends is the Resend account's.
create table if not exists public.email_quota_days (
  day      date primary key,
  reserved integer not null default 0
);

create table if not exists public.cron_heartbeats (
  name   text primary key,
  at     timestamptz not null default now(),
  detail jsonb
);

alter table public.email_suppressions enable row level security;
alter table public.email_events enable row level security;
alter table public.email_quota_days enable row level security;
alter table public.cron_heartbeats enable row level security;

-- ── Quiet hours ────────────────────────────────────────────────────────────

/**
 * Moves an instant out of the user's quiet window.
 *
 * Quiet hours are wall clock and usually wrap midnight, so the wrap is the
 * normal case rather than the exception. A reminder that lands inside the window
 * is pushed to the moment it ends, which is the next hour the person is awake
 * for. Stable rather than immutable: the conversion resolves against tzdata.
 */
create or replace function public.apply_quiet_hours(
  p_at      timestamptz,
  p_tz      text,
  p_enabled boolean,
  p_start   time,
  p_end     time
)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local  timestamp;
  v_inside boolean;
  v_target timestamp;
begin
  if not coalesce(p_enabled, false) or p_start = p_end then
    return p_at;
  end if;

  v_local := p_at at time zone p_tz;

  if p_start < p_end then
    v_inside := v_local::time >= p_start and v_local::time < p_end;
  else
    v_inside := v_local::time >= p_start or v_local::time < p_end;
  end if;

  if not v_inside then
    return p_at;
  end if;

  v_target := date_trunc('day', v_local) + p_end;
  if v_target <= v_local then
    v_target := v_target + interval '1 day';
  end if;

  return v_target at time zone p_tz;
end;
$$;

-- ── Recompute ──────────────────────────────────────────────────────────────

/**
 * Rebuilds the pending task reminders for one task.
 *
 * Pending rows are deleted rather than cancelled, because a cancelled row keeps
 * its dedupe_key and would block the identical row a re-save produces. Rows
 * already claimed or sent are left alone: that email is gone.
 *
 * Definer, because the app calls it as the signed-in user and reminder_deliveries
 * takes no writes from authenticated. The guard below is what keeps that safe.
 */
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
         and u.email_enabled
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

revoke all on function public.recompute_task_notifications(uuid) from public, anon;
grant execute on function public.recompute_task_notifications(uuid) to authenticated, service_role;

/** Marks a task for recompute. Definer, because the queue takes no user writes. */
create or replace function public.queue_task_recompute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.tasks;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  insert into public.notification_recompute_queue (user_id, task_id)
  values (v_row.user_id, v_row.id)
  on conflict do nothing;

  return null;
end;
$$;

drop trigger if exists tasks_queue_notifications on public.tasks;
create trigger tasks_queue_notifications
  after insert or delete or update of
    due_date, due_time, status, deleted_at, archived_at, series_id
  on public.tasks
  for each row execute function public.queue_task_recompute();

/**
 * A settings change invalidates every pending reminder the user has.
 *
 * The pending rows go rather than being recomputed here: a timezone change moves
 * every instant, and doing that work inside the sync transaction is exactly what
 * the queue exists to avoid. Zero task rows change.
 */
create or replace function public.queue_user_recompute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.reminder_deliveries
   where user_id = new.user_id and kind = 'task_reminder' and status = 'pending';

  insert into public.notification_recompute_queue (user_id, task_id)
  values (new.user_id, null)
  on conflict do nothing;

  return null;
end;
$$;

drop trigger if exists user_settings_queue_notifications on public.user_settings;
create trigger user_settings_queue_notifications
  after update of
    timezone, all_day_reminder_time, email_enabled, reminders_enabled,
    reminder_lead_minutes, quiet_hours_enabled, quiet_start, quiet_end
  on public.user_settings
  for each row execute function public.queue_user_recompute();

/** Drains the queue. Bounded, because a tick has one minute to finish. */
create or replace function public.drain_notification_recompute(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item  record;
  v_count integer := 0;
begin
  for v_item in
    delete from public.notification_recompute_queue
     where ctid in (
       select ctid from public.notification_recompute_queue order by queued_at limit p_limit
     )
    returning user_id, task_id
  loop
    if v_item.task_id is not null then
      perform public.recompute_task_notifications(v_item.task_id);
    else
      perform public.recompute_task_notifications(t.id)
         from public.tasks t
        where t.user_id = v_item.user_id
          and t.deleted_at is null
          and t.due_date is not null
          and t.status not in ('done', 'cancelled');
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ── The periodic enqueues ──────────────────────────────────────────────────

/**
 * One digest per user per local day, once their local clock passes digest_time.
 *
 * scheduled_at is the tick's own instant rather than the digest time: by the time
 * this row exists that moment has already passed.
 *
 * `p_now` exists so a test can stand on a spring-forward morning and prove the
 * catch-up predicate holds there. Nothing but cron can call this, so the seam is
 * not reachable from a session.
 */
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
   where u.email_enabled
     and u.digest_enabled
     and l.local_time >= u.digest_time
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** One nudge per user per local day, and only when something is actually late. */
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
   where u.email_enabled
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

/** One review per ISO week, keyed by the week so a missed Sunday cannot double up. */
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
   where u.email_enabled
     and u.weekly_review_enabled
     and extract(isodow from l.local_date) = u.weekly_review_day
     and l.local_time >= u.weekly_review_time
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Claim, send, settle ────────────────────────────────────────────────────

/** The Resend free tier is 100 a day. Ten stay back for auth mail. */
create or replace function public.email_daily_ceiling()
returns integer language sql immutable as $$ select 90 $$;

/**
 * Takes one email's worth of the day's global allowance.
 *
 * Returns false when the day is spent, which leaves the delivery pending rather
 * than failing it: tomorrow's allowance will carry it, and a reminder arriving
 * late beats a reminder that never arrives and says nothing about why.
 */
create or replace function public.reserve_email_quota(p_day date default current_date)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reserved integer;
begin
  insert into public.email_quota_days (day, reserved)
  values (p_day, 1)
  on conflict (day) do update
    set reserved = public.email_quota_days.reserved + 1
    where public.email_quota_days.reserved < public.email_daily_ceiling()
  returning reserved into v_reserved;

  return v_reserved is not null;
end;
$$;

/**
 * Everything the renderer needs for one delivery, as one jsonb value.
 *
 * Built here rather than in the route so the row can be frozen at claim time: a
 * retry after a crash renders the same email even if the task moved since.
 */
create or replace function public.reminder_payload(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_d      public.reminder_deliveries;
  v_local  date;
  v_result jsonb;
begin
  select * into v_d from public.reminder_deliveries where id = p_id;
  if v_d.id is null then
    return null;
  end if;

  v_local := coalesce(v_d.local_date, (now() at time zone
    (select timezone from public.user_settings where user_id = v_d.user_id))::date);

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

  -- The three digest shapes share their item lists, so they share one build.
  select jsonb_build_object(
    'kind', v_d.kind,
    'localDate', v_local,
    'today', public.digest_items(v_d.user_id, v_local, v_local, true, 25),
    'overdue', public.digest_items(v_d.user_id, null, v_local - 1, false, 25),
    'dueSoon', public.digest_items(v_d.user_id, v_local + 1, v_local + 3, false, 25),
    'completedThisWeek', (
      select count(*) from public.tasks t
       where t.user_id = v_d.user_id
         and t.deleted_at is null
         and t.completed_at >= (v_local - 6)::timestamp at time zone
             (select timezone from public.user_settings where user_id = v_d.user_id)
    ),
    'openTotal', (
      select count(*) from public.tasks t
       where t.user_id = v_d.user_id
         and t.deleted_at is null
         and t.archived_at is null
         and t.status not in ('done', 'cancelled')
    )
  ) into v_result;

  return v_result;
end;
$$;

/**
 * Open tasks in a date window, newest deadline first, as jsonb items.
 *
 * `p_from` null means "no lower bound", which is what overdue needs. Planned
 * items join the window when asked for, because a Today list is a plan rather
 * than a pile of deadlines and the digest is that list.
 */
create or replace function public.digest_items(
  p_user            uuid,
  p_from            date,
  p_to              date,
  p_include_planned boolean,
  p_limit           integer default 25
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
 * Claims what is due, and answers with everything needed to send it.
 *
 * `for update skip locked` plus incrementing attempts at claim time rather than
 * at send time is what bounds a process that dies mid-send: it comes back through
 * the reaper with one attempt spent instead of looping forever.
 *
 * Suppressions are re-checked here rather than at enqueue, so a bounce that
 * landed in between still takes effect. Over the per-user daily cap the row
 * becomes a visible `skipped` rather than silence.
 */
create or replace function public.claim_reminder_batch(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     record;
  v_email   text;
  v_set     public.user_settings;
  v_sent    integer;
  v_payload jsonb;
  v_claimed jsonb := '[]'::jsonb;
  v_skipped integer := 0;
  v_quota   boolean := true;
begin
  for v_row in
    select d.* from public.reminder_deliveries d
     where d.status = 'pending'
       and d.scheduled_at <= now()
     order by d.scheduled_at
     limit greatest(coalesce(p_limit, 25), 1)
     for update skip locked
  loop
    select * into v_set from public.user_settings where user_id = v_row.user_id;
    select email into v_email from public.profiles where id = v_row.user_id;

    if v_email is null or not coalesce(v_set.email_enabled, false) then
      update public.reminder_deliveries
         set status = 'cancelled', reason = 'email off', updated_at = now()
       where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if exists (select 1 from public.email_suppressions where email = v_email) then
      update public.reminder_deliveries
         set status = 'skipped', reason = 'suppressed', updated_at = now()
       where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_row.kind = 'task_reminder' then
      select count(*) into v_sent
        from public.reminder_deliveries d
       where d.user_id = v_row.user_id
         and d.kind = 'task_reminder'
         and d.status in ('claimed', 'sent')
         -- Null when a row is neither, and a null comparison drops the row,
         -- which is the answer wanted here.
         and coalesce(d.sent_at, d.claimed_at) >=
             date_trunc('day', now() at time zone v_set.timezone) at time zone v_set.timezone;

      if v_sent >= v_set.max_reminder_emails_per_day then
        update public.reminder_deliveries
           set status = 'skipped', reason = 'over the daily cap', updated_at = now()
         where id = v_row.id;
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    v_payload := coalesce(v_row.payload, public.reminder_payload(v_row.id));

    if v_payload is null then
      update public.reminder_deliveries
         set status = 'cancelled', reason = 'nothing left to say', updated_at = now()
       where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Reserved after the row is known to be sendable, so a cancelled delivery
    -- does not eat a slot out of the day's allowance.
    if not public.reserve_email_quota() then
      -- The account's day is spent. Everything left stays pending.
      v_quota := false;
      exit;
    end if;

    update public.reminder_deliveries
       set status = 'claimed',
           attempts = attempts + 1,
           claimed_at = now(),
           payload = v_payload,
           updated_at = now()
     where id = v_row.id;

    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'id', v_row.id,
      'kind', v_row.kind,
      'email', v_email,
      'scheduledAt', v_row.scheduled_at,
      'dedupeKey', v_row.dedupe_key,
      'attempts', v_row.attempts + 1,
      'timezone', v_set.timezone,
      'tokenVersion', v_set.email_token_version,
      'payload', v_payload
    ));
  end loop;

  return jsonb_build_object(
    'claimed', v_claimed,
    'skipped', v_skipped,
    'quotaAvailable', v_quota
  );
end;
$$;

/** Settles a group that went out as one email. */
create or replace function public.mark_reminders_sent(p_ids uuid[], p_message_id text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.reminder_deliveries
     set status = 'sent', sent_at = now(), provider_message_id = p_message_id,
         last_error = null, updated_at = now()
   where id = any (p_ids) and status = 'claimed';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * Returns a group to the queue, or gives up on it.
 *
 * Past max_attempts the row becomes `failed` and stays visible. A delivery that
 * quietly disappears is how somebody misses a deadline and never learns why.
 */
create or replace function public.mark_reminders_failed(p_ids uuid[], p_error text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.reminder_deliveries
     set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
         last_error = left(p_error, 500),
         claimed_at = null,
         updated_at = now()
   where id = any (p_ids) and status = 'claimed';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** Claims stuck longer than this are assumed dead and go back in the queue. */
create or replace function public.reap_stale_reminder_claims()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.reminder_deliveries
     set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
         claimed_at = null,
         last_error = coalesce(last_error, 'claimed and never settled'),
         updated_at = now()
   where status = 'claimed'
     and claimed_at < now() - interval '5 minutes';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.record_cron_heartbeat(p_name text, p_detail jsonb default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.cron_heartbeats (name, at, detail)
  values (p_name, now(), p_detail)
  on conflict (name) do update set at = now(), detail = excluded.detail;
$$;

-- ── The tick ───────────────────────────────────────────────────────────────

/**
 * Reads a secret from Vault, or null where there is no Vault.
 *
 * The URL and the shared secret live there rather than inside the cron command,
 * because `cron.job.command` is readable by anybody who can read the cron schema.
 * Revoked from everybody: a definer function over Vault is not something a user
 * session should be able to call.
 */
create or replace function public.notifications_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into v_value using p_name;
  return v_value;
end;
$$;

revoke all on function public.notifications_secret(text) from public, anon, authenticated;

/**
 * One minute of work.
 *
 * The POST is fire-and-forget: pg_net queues the request and this transaction
 * cannot learn whether it landed. Two things make that survivable. The endpoint
 * claims everything overdue rather than this minute's slice, so a dropped call is
 * absorbed by the next tick, and the route writes its own heartbeat, because
 * cron.job_run_details only proves the SQL ran.
 */
create or replace function public.notifications_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reaped  integer;
  v_drained integer;
  v_digests integer;
  v_nudges  integer;
  v_reviews integer;
  v_due     integer;
  v_url     text;
  v_secret  text;
  v_posted  boolean := false;
begin
  v_reaped  := public.reap_stale_reminder_claims();
  v_drained := public.drain_notification_recompute(500);
  v_digests := public.enqueue_daily_digests();
  v_nudges  := public.enqueue_overdue_nudges();
  v_reviews := public.enqueue_weekly_reviews();

  select count(*) into v_due
    from public.reminder_deliveries
   where status = 'pending' and scheduled_at <= now();

  if v_due > 0 and to_regproc('net.http_post') is not null then
    v_url    := public.notifications_secret('tend_reminders_url');
    v_secret := public.notifications_secret('tend_cron_secret');

    if v_url is not null and v_secret is not null then
      perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object('due', v_due),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', v_secret
        )
      );
      v_posted := true;
    end if;
  end if;

  perform public.record_cron_heartbeat('notifications_tick', jsonb_build_object(
    'reaped', v_reaped, 'drained', v_drained, 'digests', v_digests,
    'nudges', v_nudges, 'reviews', v_reviews, 'due', v_due, 'posted', v_posted
  ));

  return jsonb_build_object(
    'reaped', v_reaped, 'drained', v_drained, 'digests', v_digests,
    'nudges', v_nudges, 'reviews', v_reviews, 'due', v_due, 'posted', v_posted
  );
end;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Only the recompute is reachable from a user session, and only for their own
-- task. Everything else belongs to the cron and to the route.

revoke all on function public.claim_reminder_batch(integer) from public, anon, authenticated;
revoke all on function public.mark_reminders_sent(uuid[], text) from public, anon, authenticated;
revoke all on function public.mark_reminders_failed(uuid[], text) from public, anon, authenticated;
revoke all on function public.reminder_payload(uuid) from public, anon, authenticated;
revoke all on function public.digest_items(uuid, date, date, boolean, integer) from public, anon, authenticated;
revoke all on function public.notifications_tick() from public, anon, authenticated;
revoke all on function public.enqueue_daily_digests(timestamptz) from public, anon, authenticated;
revoke all on function public.enqueue_overdue_nudges(timestamptz) from public, anon, authenticated;
revoke all on function public.enqueue_weekly_reviews(timestamptz) from public, anon, authenticated;
revoke all on function public.reap_stale_reminder_claims() from public, anon, authenticated;
revoke all on function public.apply_quiet_hours(timestamptz, text, boolean, time, time)
  from public, anon;
revoke all on function public.drain_notification_recompute(integer) from public, anon, authenticated;
revoke all on function public.reserve_email_quota(date) from public, anon, authenticated;
revoke all on function public.record_cron_heartbeat(text, jsonb) from public, anon, authenticated;

grant execute on function public.claim_reminder_batch(integer) to service_role;
grant execute on function public.mark_reminders_sent(uuid[], text) to service_role;
grant execute on function public.mark_reminders_failed(uuid[], text) to service_role;
grant execute on function public.notifications_tick() to service_role;
grant execute on function public.record_cron_heartbeat(text, jsonb) to service_role;

-- ── The schedule ───────────────────────────────────────────────────────────
-- Guarded so this file also runs where pg_cron does not exist, which is every
-- test run. The secrets it needs are set once, by hand, in the dashboard:
--
--   select vault.create_secret('https://<app>/api/cron/reminders', 'tend_reminders_url');
--   select vault.create_secret('<a long random string>', 'tend_cron_secret');

do $$
begin
  if to_regproc('cron.schedule') is not null then
    perform cron.unschedule('tend-notifications-tick')
      where exists (select 1 from cron.job where jobname = 'tend-notifications-tick');
    perform cron.schedule('tend-notifications-tick', '* * * * *',
      $job$select public.notifications_tick()$job$);
  end if;
end;
$$;
