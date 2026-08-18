import { describe, expect, it } from 'vitest';
import { COALESCE_WINDOW_MS, groupDeliveries } from './group';
import type { ClaimedDelivery, ReminderKind } from './types';

/**
 * Coalescing, which is the first line of defence on 100 emails a day and also the
 * difference between an app somebody keeps and an app somebody filters.
 */

let count = 0;

function delivery(over: {
  kind?: ReminderKind;
  email?: string;
  minutes?: number;
}): ClaimedDelivery {
  count += 1;
  const base = Date.parse('2026-09-01T13:00:00Z');
  return {
    id: `d${count}`,
    kind: over.kind ?? 'task_reminder',
    email: over.email ?? 'a@example.com',
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

  it('never mix two addresses', () => {
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
