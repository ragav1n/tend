-- ═══════════════════════════════════════════════════════════════════════════
-- 0012  find pg_net wherever it was installed
--
-- Supabase's extension dialog offers a schema for pg_net and defaults to
-- `extensions`, while pg_cron is pinned to `pg_catalog` with no choice. So the
-- functions can end up as `extensions.http_post` rather than `net.http_post`,
-- depending on which button somebody pressed months earlier.
--
-- The tick guarded its call with `to_regproc('net.http_post') is not null`, which
-- answers null for a missing extension and for a differently placed one alike. The
-- symptom would have been the worst kind: every tick reporting `posted: false`,
-- every digest sitting pending, and nothing anywhere saying why.
--
-- Now the schema comes out of pg_proc, preferring `net` when both exist. That also
-- survives the day pg_net ships a second http_post overload, which would make
-- to_regproc ambiguous and send it back to null.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_schema  text;
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

  if v_due > 0 then
    -- Found rather than assumed. Supabase's extension dialog lets pg_net land in
    -- `extensions` as well as `net`, and to_regproc on a guessed name answers null
    -- for both a missing extension and a differently placed one, so the guard read
    -- as "no pg_net here" and the POST never happened. Read from pg_proc instead,
    -- which also survives the day pg_net grows a second http_post overload.
    select n.nspname into v_schema
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'http_post'
       and n.nspname in ('net', 'extensions')
     order by case n.nspname when 'net' then 0 else 1 end
     limit 1;

    v_url    := public.notifications_secret('tend_reminders_url');
    v_secret := public.notifications_secret('tend_cron_secret');

    if v_schema is not null and v_url is not null and v_secret is not null then
      execute format(
        'select %I.http_post(url := $1, body := $2, headers := $3)', v_schema
      ) using
        v_url,
        jsonb_build_object('due', v_due),
        jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
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
