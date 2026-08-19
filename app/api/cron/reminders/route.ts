import { NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/email/authorize';
import { groupDeliveries, groupIdempotencyKey } from '@/lib/email/group';
import { describeMode, resolveMode } from '@/lib/email/mode';
import { renderGroup } from '@/lib/email/render';
import { sendEmail } from '@/lib/email/send';
import type { ClaimResponse, EmailGroup } from '@/lib/email/types';
import { pushMessage } from '@/lib/push/message';
import { sendPush } from '@/lib/push/send';
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
 *
 * Since 0014 a claimed group says which channels are open for it, and this sends
 * on the ones that are. A group is settled as sent if any channel carried it: an
 * email that landed is a reminder delivered whatever a push service did with its
 * copy, and the reverse holds for somebody who has email turned off. It is failed
 * only when everything that was meant to carry it failed, and the row keeps every
 * reason so a reminder that never arrived can be explained.
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
  let pushed = 0;
  const failures: string[] = [];

  for (const group of groups) {
    const ids = group.deliveries.map((delivery) => delivery.id);
    const reasons: string[] = [];
    /** What to record as the provider id, from whichever channel answered. */
    let receipt: string | null = null;

    if (group.channels.email) {
      try {
        receipt = await email(group);
      } catch (thrown) {
        reasons.push(`email: ${describe(thrown)}`);
      }
    }

    if (group.channels.push) {
      try {
        const outcome = await sendPush(supabase, group.userId, pushMessage(group));
        pushed += outcome.delivered;
        if (outcome.delivered > 0) {
          receipt ??= `push:${outcome.delivered}`;
        } else if (!outcome.disabled) {
          // No VAPID pair is a configuration state rather than a failure, so it
          // is not a reason. Everything else here is: the claim said this channel
          // was open, and by the time it ran nothing on it answered.
          const tried = outcome.failed + outcome.removed;
          reasons.push(
            tried === 0
              ? 'push: the last device unsubscribed after the claim'
              : `push: nothing delivered, ${outcome.removed} device(s) gone and ${outcome.failed} failed`,
          );
        }
      } catch (thrown) {
        reasons.push(`push: ${describe(thrown)}`);
      }
    }

    if (receipt !== null) {
      await supabase.rpc('mark_reminders_sent', { p_ids: ids, p_message_id: receipt });
      sent += ids.length;
      // Worth reporting even on success: a group that went out by push while its
      // email failed is a half outcome, and silence here would hide it.
      failures.push(...reasons);
      continue;
    }

    const message = reasons.join('; ') || 'no channel carried it';
    failures.push(message);
    // Back to pending, or failed once the attempts are spent. Either way the row
    // keeps the reason, so a delivery that never arrived can be explained.
    await supabase.rpc('mark_reminders_failed', { p_ids: ids, p_error: message });
    failed += ids.length;
  }

  const summary = {
    claimed: claim.claimed?.length ?? 0,
    groups: groups.length,
    sent,
    failed,
    pushed,
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

/** Renders and sends one group as mail, answering with Resend's id. */
async function email(group: EmailGroup): Promise<string> {
  const rendered = await renderGroup(group);
  const outcome = await sendEmail({
    ...rendered,
    // Non-null whenever the email channel is open, which the claim guarantees and
    // renderGroup asserts.
    to: group.email!,
    // Derived from which deliveries are in this group, so a replay after a crash
    // returns Resend's original result while a regenerated delivery is treated as
    // the new send it is.
    idempotencyKey: groupIdempotencyKey(group),
  });
  return outcome.id ?? `${outcome.mode}:${group.deliveries[0]!.dedupeKey}`;
}

function describe(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

export async function POST(request: Request) {
  return handle(request);
}

/** Same work, for a manual run with curl or a Vercel cron. */
export async function GET(request: Request) {
  return handle(request);
}
