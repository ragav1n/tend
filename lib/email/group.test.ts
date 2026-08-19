import { describe, expect, it } from 'vitest';
import { COALESCE_WINDOW_MS, groupDeliveries, groupIdempotencyKey } from './group';
import type { ClaimedDelivery, ReminderKind } from './types';

/**
 * Coalescing, which is the first line of defence on 100 emails a day and also the
 * difference between an app somebody keeps and an app somebody filters.
 */

let count = 0;

function delivery(over: {
  kind?: ReminderKind;
  userId?: string;
  email?: string | null;
  channels?: { email: boolean; push: boolean };
  minutes?: number;
}): ClaimedDelivery {
  count += 1;
  const base = Date.parse('2026-09-01T13:00:00Z');
  const email = over.email === undefined ? 'a@example.com' : over.email;
  return {
    id: `d${count}`,
    // Grouping keys on the user, so an unspecified one has to follow the address
    // or every fixture in this file would collapse into one group.
    userId: over.userId ?? `u:${email ?? 'none'}`,
    kind: over.kind ?? 'task_reminder',
    email,
    channels: over.channels ?? { email: true, push: false },
    scheduledAt: new Date(base + (over.minutes ?? 0) * 60_000).toISOString(),
    dedupeKey: `k${count}`,
    attempts: 1,
    timezone: 'America/New_York',
    tokenVersion: 1,
    payload: {
      kind: 'task_reminder',
      task: {
        id: `t${count}`,
        title: `Task ${count}`,
        notes: '',
        dueDate: '2026-09-01',
        dueTime: '09:00:00',
        priority: 0,
        project: null,
      },
    },
  };
}

describe('task reminders', () => {
  it('become one email when they fall inside the window', () => {
    const groups = groupDeliveries([
      delivery({ minutes: 0 }),
      delivery({ minutes: 4 }),
      delivery({ minutes: 9 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.deliveries).toHaveLength(3);
  });

  it('split once the window is past', () => {
    const groups = groupDeliveries([
      delivery({ minutes: 0 }),
      delivery({ minutes: 11 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('measure the window from the first, so a trickle cannot chain', () => {
    // Nine minutes apart each, which would chain forever if the window moved with
    // every arrival. A reminder held back an hour is not a reminder.
    const groups = groupDeliveries([
      delivery({ minutes: 0 }),
      delivery({ minutes: 9 }),
      delivery({ minutes: 18 }),
      delivery({ minutes: 27 }),
    ]);

    expect(groups).toHaveLength(2);
    expect(COALESCE_WINDOW_MS).toBe(600_000);
  });

  it('never mix two people', () => {
    const groups = groupDeliveries([
      delivery({ email: 'a@example.com' }),
      delivery({ email: 'b@example.com', minutes: 1 }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.email).sort()).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('never mix two accounts that have no address', () => {
    // The reason grouping keys on the user. Two push-only accounts both carry a
    // null address, and keying on that would put one person's tasks in the other
    // person's notification.
    const groups = groupDeliveries([
      delivery({ userId: 'u1', email: null, channels: { email: false, push: true } }),
      delivery({
        userId: 'u2',
        email: null,
        channels: { email: false, push: true },
        minutes: 1,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.userId)).toEqual(['u1', 'u2']);
  });

  it('carries the channels the claim decided', () => {
    const groups = groupDeliveries([
      delivery({ channels: { email: false, push: true } }),
      delivery({ channels: { email: false, push: true }, minutes: 2 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.channels).toEqual({ email: false, push: true });
  });
});

describe('everything else', () => {
  it('stays one email each, since the schedule already made it one a day', () => {
    const groups = groupDeliveries([
      delivery({ kind: 'daily_digest' }),
      delivery({ kind: 'overdue_nudge', minutes: 1 }),
      delivery({ kind: 'weekly_review', minutes: 2 }),
    ]);

    expect(groups.map((group) => group.kind)).toEqual([
      'daily_digest',
      'overdue_nudge',
      'weekly_review',
    ]);
  });
});

describe('the idempotency key', () => {
  it('is the same for the same group, whatever order the claim returned', () => {
    const [group] = groupDeliveries([delivery({ minutes: 0 }), delivery({ minutes: 2 })]);
    const reversed = { ...group!, deliveries: [...group!.deliveries].reverse() };

    expect(groupIdempotencyKey(group!)).toBe(groupIdempotencyKey(reversed));
  });

  it('changes when the group does', () => {
    const [one] = groupDeliveries([delivery({ minutes: 0 })]);
    const [two] = groupDeliveries([delivery({ minutes: 0 }), delivery({ minutes: 1 })]);

    // Resend refuses a repeated key whose body changed, so a group that grew has
    // to present a new key rather than the old one.
    expect(groupIdempotencyKey(one!)).not.toBe(groupIdempotencyKey(two!));
  });

  it('is not the dedupe key, which repeats for the same user and day', () => {
    const [group] = groupDeliveries([delivery({ kind: 'daily_digest' })]);

    // A digest row deleted and regenerated keeps its dedupe_key and gets a new id.
    // The send has to follow the id, or Resend rejects every attempt for 24 hours.
    expect(groupIdempotencyKey(group!)).not.toContain(group!.deliveries[0]!.dedupeKey);
  });
});
