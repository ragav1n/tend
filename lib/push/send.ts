import type { SupabaseClient } from '@supabase/supabase-js';
import webpush, { WebPushError } from 'web-push';
import { vapid } from './env';
import type { PushMessage } from './message';

/**
 * One notification, to every browser a person has enabled it on.
 *
 * Best effort by design. The email is the record of a reminder and its row is
 * settled by whether the group went out at all, so a push service that is having
 * a bad afternoon must not fail a delivery that also went by mail. What this does
 * owe the caller is an honest count, so a group with no other channel can be
 * failed rather than marked sent.
 *
 * Dead subscriptions are deleted rather than retried. A push service answering 404
 * or 410 is saying the browser is gone for good: the app was uninstalled, or the
 * profile was cleared. Keeping the row would mean a permanent failure on every
 * tick forever, and would keep the push channel open in the claim for somebody who
 * cannot receive anything.
 *
 * Softer failures get a strike instead. A run of them is the same conclusion
 * arrived at slowly, which is what the counter is for.
 */

/** Strikes before an endpoint that never works is retired. */
export const MAX_FAILURES = 5;

/** How long a push service should hold a message for a device that is offline. */
const TTL_SECONDS = 3 * 60 * 60;

export interface PushOutcome {
  /** Browsers the push service accepted it for. */
  delivered: number;
  /** Subscriptions that failed but may work later. */
  failed: number;
  /** Subscriptions deleted because they are gone for good. */
  removed: number;
  /** True when there was no VAPID pair, so nothing was attempted. */
  disabled: boolean;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failures: number;
}

const NONE: PushOutcome = { delivered: 0, failed: 0, removed: 0, disabled: false };

/** 404 and 410 both mean the subscription will never work again. */
function isGone(error: unknown): boolean {
  return error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410);
}

export async function sendPush(
  supabase: SupabaseClient,
  userId: string,
  message: PushMessage,
): Promise<PushOutcome> {
  const keys = vapid();
  if (!keys) return { ...NONE, disabled: true };

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failures')
    .eq('user_id', userId);

  if (error) throw new Error(`could not read subscriptions: ${error.message}`);

  const subscriptions = (data ?? []) as SubscriptionRow[];
  if (subscriptions.length === 0) return NONE;

  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  const body = JSON.stringify(message);

  const outcome: PushOutcome = { ...NONE };
  const dead: string[] = [];

  await Promise.all(
    subscriptions.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
          { TTL: TTL_SECONDS, urgency: 'high' },
        );
        outcome.delivered += 1;
        // The strike count resets on any success, so an endpoint is only retired
        // for a run of failures rather than for five spread over a year.
        if (row.failures > 0) {
          await supabase
            .from('push_subscriptions')
            .update({ failures: 0, last_seen_at: new Date().toISOString() })
            .eq('id', row.id);
        }
      } catch (thrown) {
        if (isGone(thrown) || row.failures + 1 >= MAX_FAILURES) {
          dead.push(row.id);
          outcome.removed += 1;
          return;
        }
        outcome.failed += 1;
        await supabase
          .from('push_subscriptions')
          .update({ failures: row.failures + 1 })
          .eq('id', row.id);
      }
    }),
  );

  if (dead.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', dead);
  }

  return outcome;
}
