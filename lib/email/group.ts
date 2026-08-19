import { createHash } from 'node:crypto';
import type { ClaimedDelivery, EmailGroup } from './types';

/**
 * Ten minutes, which is the window task reminders coalesce inside.
 *
 * Long enough that "09:00 and 09:05" is one email, short enough that a reminder
 * is never held back so long it stops being a reminder.
 */
export const COALESCE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Claimed deliveries arranged into the emails they will become.
 *
 * Task reminders for one address inside the window collapse into one email.
 * Everything else is already one per person per day by construction, so it maps
 * one to one and the grouping is only here to keep the route's loop uniform.
 *
 * The window is measured from the first delivery in each group rather than from
 * the previous one, so a steady trickle cannot chain into one email an hour late.
 */
export function groupDeliveries(claimed: ClaimedDelivery[]): EmailGroup[] {
  const groups: EmailGroup[] = [];
  const open = new Map<string, { group: EmailGroup; startedAt: number }>();

  const ordered = [...claimed].sort(
    (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
  );

  for (const delivery of ordered) {
    if (delivery.kind !== 'task_reminder') {
      groups.push({
        kind: delivery.kind,
        email: delivery.email,
        timezone: delivery.timezone,
        tokenVersion: delivery.tokenVersion,
        deliveries: [delivery],
      });
      continue;
    }

    const at = Date.parse(delivery.scheduledAt);
    const existing = open.get(delivery.email);

    if (existing && at - existing.startedAt <= COALESCE_WINDOW_MS) {
      existing.group.deliveries.push(delivery);
      continue;
    }

    const group: EmailGroup = {
      kind: 'task_reminder',
      email: delivery.email,
      timezone: delivery.timezone,
      tokenVersion: delivery.tokenVersion,
      deliveries: [delivery],
    };
    groups.push(group);
    open.set(delivery.email, { group, startedAt: at });
  }

  return groups;
}

/**
 * The idempotency key for one send.
 *
 * Derived from which deliveries are in the group, and nothing else. Two different
 * jobs were being done by one value before this: `dedupe_key` stops a second row
 * existing for the same user and day, and an idempotency key stops a second send
 * of the same row. Using the first for the second broke as soon as a row was
 * deleted and regenerated, because the key repeats while the rendered body does
 * not, and Resend answers `invalid_idempotent_request` rather than replaying the
 * original. The retry then fails identically until the attempts run out, so a
 * person gets no digest at all and the row explains why in a language nobody
 * reads.
 *
 * Membership is the right input because payloads are frozen at claim time: the
 * same ids render the same bytes, so a retry after a crash still collapses into
 * one email, while a regenerated row is a new row and gets a new send.
 *
 * Sorted before hashing, so the order the claim happened to return does not
 * change the key.
 */
export function groupIdempotencyKey(group: EmailGroup): string {
  const ids = group.deliveries.map((delivery) => delivery.id).sort();
  return createHash('sha256').update(`${group.kind}:${ids.join(',')}`).digest('hex').slice(0, 48);
}
