-- ═══════════════════════════════════════════════════════════════════════════
-- 0014  a second way to reach somebody
--
-- Every reminder so far has been an email, and email is the wrong shape for
-- "this is due in ten minutes". So the pipeline grows a channel: a browser push,
-- which arrives on the lock screen of a phone with the app on its home screen.
--
-- Nothing about scheduling changes. Postgres still decides who gets told and
-- when, `notifications_tick` still drives it, and the route still only renders
-- and sends. What changes is that a claimed delivery now says which channels are
-- open for it, and the route sends on the ones that are.
--
-- Two things in here are more subtle than they look.
--
-- **Email off must no longer mean cancelled.** Somebody who turns email off and
-- turns notifications on wants reminders, and before this the claim would cancel
-- every delivery with the reason "email off". Same for a hard bounce: a
-- suppressed address is a reason to stop emailing, not a reason to stop
-- reminding. So each of those now only closes the email channel, and the row is
-- cancelled solely when nothing is left to send it on.
--
-- **The caps stay email caps.** `max_reminder_emails_per_day` and the global
-- `email_quota_days` reservation exist to protect a Resend account and an inbox.
-- Neither is a reason to hold back a push, which costs nothing and goes nowhere
-- near a mail provider. So going over a cap closes the email channel for that
-- row, and only skips the row when there was no push channel to fall back on.
--
-- One subscription row per browser per device. The endpoint is the identity: the
-- browser hands back the same one for the same registration, so re-subscribing
-- updates rather than accumulating. There is no synced "push enabled" setting on
-- purpose. Enabling notifications is a per-device permission, so the presence of
-- a row is the state, and turning it off on your laptop should not turn it off on
-- your phone.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Subscriptions ───────────────────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- The push service's URL for this browser, and its identity. Unique so a
  -- second subscribe from the same registration updates the keys rather than
  -- leaving a stale row that gets every notification twice.
  endpoint     text not null unique,
  -- The two halves of the ECDH keying material the browser generated. Without
  -- them a payload cannot be encrypted, so a row missing either is useless.
  p256dh       text not null,
  auth         text not null,
  -- Which browser this is, so a person can recognise a device in a list later.
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Consecutive send failures. A push service answering 404 or 410 means the
  -- subscription is gone for good and the row is deleted outright; this counts
  -- the softer failures, so a permanently broken endpoint can be retired.
  failures     integer not null default 0
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Own rows only, and all four verbs: this is a device registry rather than
-- history, so removing a row is how somebody turns notifications off.
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- ── The claim, with channels ────────────────────────────────────────────────

/**
 * Claims what is due, and answers with everything needed to send it.
 *
 * `for update skip locked` plus incrementing attempts at claim time rather than
 * at send time is what bounds a process that dies mid-send: it comes back through
 * the reaper with one attempt spent instead of looping forever.
 *
 * Each claimed row now carries `channels`, and the route sends on whichever are
 * true. A row reaches the route only when at least one is, so an empty pair
 * cannot occur and the route needs no special case for it.
 *
 * The order of the checks is load bearing. The staleness check from 0011 comes
 * first, because a digest about a day that has passed is stale on every channel.
 * Then everything that can close the email channel runs, and the decision to
 * cancel or skip the row is taken once, afterwards, when it is known whether a
 * push could still carry it.
 */
create or replace function public.claim_reminder_batch(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      record;
  v_email    text;
  v_set      public.user_settings;
  v_sent     integer;
  v_local    date;
  v_payload  jsonb;
  v_claimed  jsonb := '[]'::jsonb;
  v_skipped  integer := 0;
  v_quota    boolean := true;
  v_by_email boolean;
  v_by_push  boolean;
  v_reason   text;
  v_status   text;
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

    v_local := (now() at time zone v_set.timezone)::date;

    -- From 0011, and it runs before the channels because it is about neither of
    -- them. A morning digest is about that morning: if the route could not be
    -- reached for a day, the pending rows are still here, and sending them now
    -- would deliver three days of "here is your day" at once, each describing a
    -- day that has passed. The weekly review gets a wider window, since it is
    -- about a week rather than a morning.
    if v_row.local_date is not null and (
         (v_row.kind in ('daily_digest', 'overdue_nudge') and v_row.local_date < v_local)
         or (v_row.kind = 'weekly_review' and v_row.local_date < v_local - 3)
       ) then
      update public.reminder_deliveries
         set status = 'cancelled', reason = 'too late to be true', updated_at = now()
       where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_by_push := exists (
      select 1 from public.push_subscriptions s where s.user_id = v_row.user_id
    );
    v_by_email := v_email is not null and coalesce(v_set.email_enabled, false);
    v_reason := null;
    v_status := 'cancelled';

    if not v_by_email then
      v_reason := 'email off';
    elsif exists (select 1 from public.email_suppressions where email = v_email) then
      -- A bounce or a complaint. Reason enough to stop writing to that address,
      -- and no reason at all to stop telling the person their task is due.
      v_by_email := false;
      v_reason := 'suppressed';
      v_status := 'skipped';
    end if;

    if v_by_email and v_row.kind = 'task_reminder' then
      select count(*) into v_sent
        from public.reminder_deliveries d
       where d.user_id = v_row.user_id
         and d.kind = 'task_reminder'
         and d.status in ('claimed', 'sent')
         -- Rows that went out by push alone carry a reason saying why they
         -- carried no email, and they must not count against an email cap. Left
         -- in, a phone with notifications on would throttle its own reminders.
         and d.reason is null
         -- Null when a row is neither, and a null comparison drops the row,
         -- which is the answer wanted here.
         and coalesce(d.sent_at, d.claimed_at) >=
             date_trunc('day', now() at time zone v_set.timezone) at time zone v_set.timezone;

      if v_sent >= v_set.max_reminder_emails_per_day then
        v_by_email := false;
        v_reason := 'over the daily cap';
        v_status := 'skipped';
      end if;
    end if;

    if not v_by_email and not v_by_push then
      update public.reminder_deliveries
         set status = v_status, reason = v_reason, updated_at = now()
       where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
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
    -- does not eat a slot out of the day's allowance. The reservation is an email
    -- budget, so a spent day closes that channel and leaves push alone, and a
    -- push-only account never touches the budget at all.
    if v_by_email then
      if not v_quota or not public.reserve_email_quota() then
        v_quota := false;
        v_by_email := false;
        v_reason := 'over the account quota';
      end if;
    end if;

    if not v_by_email and not v_by_push then
      -- The account's day is spent and there is nothing else to send on.
      -- Everything left stays pending for tomorrow rather than being spent now.
      exit;
    end if;

    update public.reminder_deliveries
       set status = 'claimed',
           attempts = attempts + 1,
           claimed_at = now(),
           payload = v_payload,
           -- Null unless the email channel was closed, in which case it records
           -- why a row that went out by push carries no email. A sent row with a
           -- reason is the trail for "I got the notification and no mail".
           reason = v_reason,
           updated_at = now()
     where id = v_row.id;

    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'id', v_row.id,
      'userId', v_row.user_id,
      'kind', v_row.kind,
      'email', v_email,
      'scheduledAt', v_row.scheduled_at,
      'dedupeKey', v_row.dedupe_key,
      'attempts', v_row.attempts + 1,
      'timezone', v_set.timezone,
      'tokenVersion', v_set.email_token_version,
      'channels', jsonb_build_object('email', v_by_email, 'push', v_by_push),
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

revoke all on function public.claim_reminder_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_reminder_batch(integer) to service_role;
