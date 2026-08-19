-- ═══════════════════════════════════════════════════════════════════════════
-- 0009  the nightly repair
--
-- notification_recompute_queue is unlogged, which is the right trade for a queue
-- the tick drains every minute: no WAL, no replication cost, and losing it costs
-- one tick. Except that Postgres truncates an unlogged table on an unclean
-- restart, and Supabase restarts for maintenance and upgrades. A task edited in
-- the seconds before that restart loses its mark and never gets recomputed, so
-- its reminder stays wrong until somebody edits it again. Nothing reports it.
--
-- So the queue is the fast path and this is the floor. Once a night, rebuild every
-- reminder that could still fire, and cancel the pending rows whose task has since
-- been finished or thrown away.
--
-- Bounded by a date window rather than by row count: a reminder more than two
-- months out can wait for tomorrow's run, and the window keeps the work
-- proportional to what is actually about to happen rather than to how long the
-- account has existed.
-- ═══════════════════════════════════════════════════════════════════════════

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
         and u.email_enabled
         and u.reminders_enabled
    ) s;

  perform public.record_cron_heartbeat('reconcile_notifications', jsonb_build_object(
    'rebuilt', v_rebuilt, 'cancelled', v_cancelled
  ));

  return jsonb_build_object('rebuilt', v_rebuilt, 'cancelled', v_cancelled);
end;
$$;

revoke all on function public.reconcile_notifications(integer) from public, anon, authenticated;
grant execute on function public.reconcile_notifications(integer) to service_role;

-- Guarded the same way the tick is, so this file runs in the test harness too.
-- 03:17 rather than 03:00: every scheduler on the internet fires on the hour.

do $$
begin
  if to_regproc('cron.schedule') is not null then
    perform cron.unschedule('tend-reconcile-notifications')
      where exists (select 1 from cron.job where jobname = 'tend-reconcile-notifications');
    perform cron.schedule('tend-reconcile-notifications', '17 3 * * *',
      $job$select public.reconcile_notifications()$job$);
  end if;
end;
$$;
