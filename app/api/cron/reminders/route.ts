import { NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/email/authorize';
import { groupDeliveries } from '@/lib/email/group';
import { describeMode, resolveMode } from '@/lib/email/mode';
import { renderGroup } from '@/lib/email/render';
import { sendEmail } from '@/lib/email/send';
import type { ClaimResponse } from '@/lib/email/types';
import { getAdminSupabase } from '@/lib/supabase/admin';

/**
 * Sends whatever Postgres says is due.
 *
 * Called by `notifications_tick()` through pg_net, which is fire and forget: the
 * database cannot learn whether this ran. Two things make that survivable. The
 * claim takes everything overdue rather than this minute's slice, so a dropped
 * call is absorbed by the next tick, and this handler writes its own heartbeat,
 * because cron.job_run_details only proves the SQL ran and says nothing about the
 * HTTP call.
 *
 * The service-role client is used here and nowhere else. There is no session to
 * run under, and the claim has to see every user's deliveries.
 */
async function handle(request: Request) {
  if (!isCronRequest(request)) {
    // Deliberately terse. An endpoint that explains why it refused is an endpoint
    // that helps somebody guess.
    return NextResponse.json({ error: 'not authorized' }, { status: 401 });
  }

  const supabase = getAdminSupabase();
  const mode = resolveMode();

  const { data, error } = await supabase.rpc('claim_reminder_batch', { p_limit: 25 });
  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  const claim = data as ClaimResponse;
  const groups = groupDeliveries(claim.claimed ?? []);

  let sent = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const group of groups) {
    const ids = group.deliveries.map((delivery) => delivery.id);

    try {
      const rendered = await renderGroup(group);
      const outcome = await sendEmail({
        ...rendered,
        to: group.email,
        // The first delivery's key stands for the group. It is deterministic, so a
        // replay after a crash returns Resend's original result rather than a
        // second email.
        idempotencyKey: group.deliveries[0]!.dedupeKey,
      });

      await supabase.rpc('mark_reminders_sent', {
        p_ids: ids,
        p_message_id: outcome.id ?? `${outcome.mode}:${group.deliveries[0]!.dedupeKey}`,
      });
      sent += ids.length;
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      failures.push(message);
      // Back to pending, or failed once the attempts are spent. Either way the row
      // keeps the reason, so a delivery that never arrived can be explained.
      await supabase.rpc('mark_reminders_failed', { p_ids: ids, p_error: message });
      failed += ids.length;
    }
  }

  const summary = {
    claimed: claim.claimed?.length ?? 0,
    groups: groups.length,
    sent,
    failed,
    skipped: claim.skipped ?? 0,
    quotaAvailable: claim.quotaAvailable ?? true,
    mode: describeMode(mode),
  };

  await supabase.rpc('record_cron_heartbeat', {
    p_name: 'reminders_route',
    p_detail: summary,
  });

  return NextResponse.json(
    failures.length > 0 ? { ...summary, failures } : summary,
    // A failed send is reported as a 200 with a count. Returning 500 would tell
    // pg_net nothing it can act on, and the rows already carry the outcome.
    { status: 200 },
  );
}

export async function POST(request: Request) {
  return handle(request);
}

/** Same work, for a manual run with curl or a Vercel cron. */
export async function GET(request: Request) {
  return handle(request);
}
