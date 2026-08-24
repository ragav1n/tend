import { describe, expect, it } from 'vitest';
import type {
  ClaimedDelivery,
  DigestItem,
  EmailGroup,
  ReminderKind,
  SummaryPayload,
} from '@/lib/email/types';
import { pushMessage } from './message';

/**
 * What a lock screen actually says.
 *
 * A notification is two short lines and no scrollbar, so the interesting part is
 * what gets left out. The title has to carry the answer on its own, because a body
 * is collapsed on most phones until the notification is expanded, and a title that
 * needs the body to make sense is a title nobody reads.
 */

const CHANNELS = { email: false, push: true };

const item = (over: Partial<DigestItem> = {}): DigestItem => ({
  id: 't1',
  title: 'Water the plants',
  dueDate: '2026-09-01',
  dueTime: null,
  priority: 0,
  project: null,
  planned: false,
  ...over,
});

const summary = (over: Partial<SummaryPayload> = {}): SummaryPayload => ({
  kind: 'daily_digest',
  localDate: '2026-09-01',
  today: [],
  overdue: [],
  dueSoon: [],
  completedThisWeek: 0,
  openTotal: 0,
  ...over,
});

function group(kind: ReminderKind, payloads: ClaimedDelivery['payload'][]): EmailGroup {
  return {
    kind,
    userId: 'u1',
    email: null,
    channels: CHANNELS,
    timezone: 'America/New_York',
    tokenVersion: 1,
    deliveries: payloads.map((payload, index) => ({
      id: `d${index}`,
      userId: 'u1',
      kind,
      email: null,
      channels: CHANNELS,
      scheduledAt: '2026-09-01T13:00:00Z',
      dedupeKey: `k${index}`,
      attempts: 1,
      timezone: 'America/New_York',
      tokenVersion: 1,
      payload,
    })),
  };
}

const task = (over: Record<string, unknown> = {}) => ({
  kind: 'task_reminder' as const,
  task: {
    id: 't1',
    title: 'Repot the ficus',
    notes: '',
    dueDate: '2026-09-01',
    dueTime: '09:00:00',
    priority: 0,
    project: null,
    ...over,
  },
});

describe('one task', () => {
  it('puts the task in the title and the detail underneath', () => {
    const message = pushMessage(group('task_reminder', [task({ project: 'Home' })]));

    expect(message.title).toBe('Repot the ficus');
    expect(message.body).toBe('Due 9:00 am · Home');
    expect(message.url).toBe('/today');
  });

  it('says due now when there is no time on it', () => {
    const message = pushMessage(group('task_reminder', [task({ dueTime: null })]));
    expect(message.body).toBe('Due now');
  });
});

describe('several tasks at once', () => {
  it('counts them in the title and names them in the body', () => {
    const message = pushMessage(
      group('task_reminder', [
        task({ title: 'Repot the ficus' }),
        task({ title: 'Water the plants' }),
      ]),
    );

    expect(message.title).toBe('2 due now: Repot the ficus and 1 more');
    expect(message.body).toBe('Repot the ficus, Water the plants');
  });

  it('stops naming after three', () => {
    const message = pushMessage(
      group(
        'task_reminder',
        ['One', 'Two', 'Three', 'Four', 'Five'].map((title) => task({ title })),
      ),
    );
    expect(message.body).toBe('One, Two, Three, and 2 more');
  });

  it('tags per group, so two reminders do not replace each other', () => {
    // Summaries share a tag on purpose: a second digest should update the first.
    // Two different tasks falling due an hour apart are two different things.
    const first = pushMessage(group('task_reminder', [task()]));
    const digest = pushMessage(group('daily_digest', [summary()]));

    expect(first.tag).toBe('task:k0');
    expect(digest.tag).toBe('daily_digest');
  });
});

describe('the summaries', () => {
  it('leads a digest with what is late', () => {
    const message = pushMessage(
      group('daily_digest', [
        summary({
          today: [item({ title: 'Water the plants' })],
          overdue: [item({ id: 't2', title: 'Repot the ficus' })],
        }),
      ]),
    );

    // Late outranks today in the title, and the title having named it is why the
    // body does not name it again.
    expect(message.title).toBe('Repot the ficus is late, and 1 more to do');
    expect(message.body).toBe('Water the plants');
  });

  it('says so plainly when a day is clear', () => {
    const message = pushMessage(group('daily_digest', [summary()]));
    expect(message.title).toBe('Nothing due today');
    expect(message.body).toBe('Nothing due. Enjoy it.');
  });

  it('names the oldest late task in the nudge', () => {
    const message = pushMessage(
      group('overdue_nudge', [summary({ kind: 'overdue_nudge', overdue: [item(), item({ id: 't2' })] })]),
    );
    expect(message.title).toBe('Water the plants, and 1 more past due');
  });

  it('never repeats the named task in the body, even as the only late one', () => {
    const message = pushMessage(
      group('overdue_nudge', [
        summary({ kind: 'overdue_nudge', overdue: [item()], openTotal: 9 }),
      ]),
    );

    expect(message.title).toBe('Water the plants is past due');
    // Nothing left to list, so it says the one thing the title did not.
    expect(message.body).toBe('9 tasks open');
  });

  it('sends the weekly review to the logbook, and mentions a streak worth having', () => {
    const message = pushMessage(
      group('weekly_review', [
        summary({ kind: 'weekly_review', completedThisWeek: 12, openTotal: 4, streak: 5 }),
      ]),
    );

    expect(message.title).toBe('12 done last week, 4 still open');
    // Done and open are already in the title, so the body carries the run.
    expect(message.body).toBe('5 days in a row');
    expect(message.url).toBe('/logbook');
  });

  it('leaves a streak of one out, because one day is not a run', () => {
    const message = pushMessage(
      group('weekly_review', [
        summary({ kind: 'weekly_review', completedThisWeek: 2, openTotal: 1, streak: 1 }),
      ]),
    );
    expect(message.body).toBe('2 tasks closed');
  });
});
