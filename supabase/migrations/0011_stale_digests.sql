-- ═══════════════════════════════════════════════════════════════════════════
-- 0011  a digest that is no longer about today does not go out
--
-- Deliveries stay pending until something claims them, which is what makes a
-- dropped cron minute harmless. Taken further it stops being harmless: if the
-- route cannot be reached for three days, three digests are waiting, and the next
-- successful run sends all of them at once. Each one says "here is your day" about
-- a day that has passed, and each one spends a slot of the daily allowance.
--
-- So the claim checks the row against the user's local date and cancels what has
-- gone stale. A daily digest and an overdue nudge are about one day. A weekly
-- review gets three days of grace, because it is about a week and arriving on
-- Tuesday for last week still reads correctly.
--
-- Cancelled rather than skipped: nothing about this is retryable, and the reason
-- stays on the row so a gap in somebody's morning mail can be explained.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_local   date;
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

    v_local := (now() at time zone v_set.timezone)::date;

    -- A morning digest is about that morning. If the route could not be reached
    -- for a day, the pending rows are still here, and sending them now would put
    -- three days of "here is your day" in somebody's inbox at once, each one
    -- describing tasks as they stood on a day that has passed. The weekly review
    -- gets a wider window, since it is about a week rather than a morning.
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
