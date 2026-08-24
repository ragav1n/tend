import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderGroup } from './render';
import type { ClaimedDelivery, EmailGroup, ReminderKind, SummaryPayload } from './types';

/**
 * The templates, rendered.
 *
 * Email cannot be checked by looking at it once: the markup has to stay tables
 * with inline styles, or Outlook's Word engine drops the layout on the floor and
 * nobody finds out until somebody forwards a screenshot. So this asserts the
 * shape as well as the words.
 *
 * It also stands in for the payload contract with 0008. Every kind is rendered
 * from the exact jsonb `reminder_payload` builds, so a payload that changes shape
 * server-side breaks a test rather than an inbox.
 */

beforeEach(() => {
  vi.stubEnv('EMAIL_TOKEN_SECRET', 'a-long-random-string');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tend.example.com');
});

const item = (over: Partial<SummaryPayload['today'][number]> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Water the plants',
  dueDate: '2026-09-01',
  dueTime: '18:00:00',
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

const CHANNELS = { email: true, push: false };

function group(kind: ReminderKind, payloads: ClaimedDelivery['payload'][]): EmailGroup {
  return {
    kind,
    userId: 'u1',
    email: 'me@example.com',
    channels: CHANNELS,
    timezone: 'America/New_York',
    tokenVersion: 2,
    deliveries: payloads.map((payload, index) => ({
      id: `d${index}`,
      userId: 'u1',
      kind,
      email: 'me@example.com',
      channels: CHANNELS,
      scheduledAt: '2026-09-01T22:00:00Z',
      dedupeKey: `k${index}`,
      attempts: 1,
      timezone: 'America/New_York',
      tokenVersion: 2,
      payload,
    })),
  };
}

const task = (over: Record<string, unknown> = {}) => ({
  kind: 'task_reminder' as const,
  task: {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Water the plants',
    notes: 'The fig needs less than you think.',
    dueDate: '2026-09-01',
    dueTime: '18:00:00',
    priority: 2,
    project: 'Garden',
    ...over,
  },
});

describe('the digest', () => {
  it('names the late task in the subject, then counts the rest', async () => {
    const email = await renderGroup(
      group('daily_digest', [
        summary({
          today: [item(), item({ id: 'b', title: 'Call the bank' })],
          overdue: [item({ id: 'c', title: 'Renew the passport', dueDate: '2026-08-28' })],
        }),
      ]),
    );

    // Late outranks today. A subject naming a task due at five while something
    // has already slipped is a subject that buries the alarm.
    expect(email.subject).toBe('Renew the passport is late, and 2 more to do');
    expect(email.html).toContain('Water the plants');
    expect(email.html).toContain('Renew the passport');
    // Real table elements, because that is the only layout Outlook honours.
    expect(email.html).toContain('<table');
    // Every cell carries a background, or the ones without it invert into mush.
    expect(email.html).toContain('background-color:#FFFFFF');
    expect(email.html).toContain('https://tend.example.com');
  });

  it('says so plainly when there is nothing due', async () => {
    const email = await renderGroup(group('daily_digest', [summary()]));

    expect(email.subject).toBe('Nothing due today');
    expect(email.text).toContain('Nothing due and nothing late.');
  });

  it('writes a plaintext part by hand rather than flattening the tables', async () => {
    const email = await renderGroup(
      group('daily_digest', [
        summary({
          today: [item({ project: 'Garden' })],
          overdue: [item({ id: 'c', title: 'Renew the passport', dueDate: '2026-08-31', dueTime: null })],
        }),
      ]),
    );

    expect(email.text).toContain('Tue 1 Sep');
    expect(email.text).toContain('- Water the plants (Garden) — today, 6:00 pm');
    expect(email.text).toContain('- Renew the passport — yesterday');
    expect(email.text).toContain('Turn these off: https://tend.example.com/api/email/unsubscribe?t=');
    // No markup leaking into the text part.
    expect(email.text).not.toContain('<');
  });
});

describe('a task reminder', () => {
  it('names the task and the time', async () => {
    const email = await renderGroup(group('task_reminder', [task()]));

    expect(email.subject).toBe('Water the plants, due 6:00 pm');
    expect(email.html).toContain('Garden');
    // The notes only ride along when there is one task to read them against.
    expect(email.html).toContain('The fig needs less than you think.');
  });

  it('folds several due at once into one email', async () => {
    const email = await renderGroup(
      group('task_reminder', [
        task(),
        task({ id: 'b', title: 'Call the bank', notes: '' }),
        task({ id: 'c', title: 'Move the car', notes: '' }),
      ]),
    );

    expect(email.subject).toBe('3 due now: Water the plants and 2 more');
    for (const title of ['Water the plants', 'Call the bank', 'Move the car']) {
      expect(email.html).toContain(title);
    }
    // Three subjects would have been three emails, which is how somebody learns
    // to filter this address.
    expect(email.text.split('\n- ')).toHaveLength(4);
  });
});

describe('the nudge and the review', () => {
  it('names the oldest late task and counts the rest', async () => {
    const email = await renderGroup(
      group('overdue_nudge', [
        summary({
          kind: 'overdue_nudge',
          overdue: [item({ dueDate: '2026-08-20' }), item({ id: 'b', dueDate: '2026-08-21' })],
        }),
      ]),
    );

    expect(email.subject).toBe('Water the plants, and 1 more past due');
    expect(email.text).toContain('Late:');
  });

  it('gives the week two numbers, since no one task is what it is about', async () => {
    const email = await renderGroup(
      group('weekly_review', [
        summary({ kind: 'weekly_review', completedThisWeek: 12, openTotal: 5 }),
      ]),
    );

    expect(email.subject).toBe('12 done last week, 5 still open');
    expect(email.text).toContain('12 tasks done, 5 tasks open');
  });
});

describe('what 0013 added to the payload', () => {
  const week = [
    { date: '2026-08-26', count: 2 },
    { date: '2026-08-27', count: 0 },
    { date: '2026-08-28', count: 5 },
    { date: '2026-08-29', count: 1 },
    { date: '2026-08-30', count: 3 },
    { date: '2026-08-31', count: 4 },
    { date: '2026-09-01', count: 3 },
  ];

  it('puts the day in a band of numbers', async () => {
    const email = await renderGroup(
      group('daily_digest', [
        summary({
          today: [item({ estimate: 45 }), item({ id: 'b', estimate: 120 })],
          overdue: [item({ id: 'c', dueDate: '2026-08-28' })],
        }),
      ]),
    );

    expect(email.html).toContain('2h 45m');
    expect(email.html).toContain('planned');
    expect(email.text).toContain('2h 45m planned.');
  });

  it('counts the backlog instead when nothing carries an estimate', async () => {
    const email = await renderGroup(
      group('daily_digest', [summary({ today: [item()], openTotal: 17 })]),
    );

    // Nobody fills in an estimate on an empty afternoon, and a stat that reads
    // 0m every morning is worse than no stat.
    expect(email.html).toContain('>17<');
    expect(email.html).toContain('open');
    expect(email.text).not.toContain('planned.');
  });

  it('says everything the app says about a task, in one line under the title', async () => {
    const email = await renderGroup(
      group('daily_digest', [
        summary({
          today: [
            item({
              project: 'Flat',
              projectColor: '#7A6A55',
              waiting: true,
              estimate: 90,
              tags: ['money', 'slow'],
              subtasks: { done: 1, total: 4 },
            }),
          ],
        }),
      ]),
    );

    expect(email.html).toContain('waiting · Flat · 1 of 4 done · 1h 30m · #money · #slow');
    // The dot is the project's colour, which is the only colour in the row.
    expect(email.html).toContain('#7A6A55');
    expect(email.text).toContain(
      '- Water the plants (waiting, Flat, 1 of 4 done, 1h 30m, #money, #slow) — today, 6:00 pm',
    );
  });

  it('scales the review chart against its own best day', async () => {
    const email = await renderGroup(
      group('weekly_review', [
        summary({ kind: 'weekly_review', completedThisWeek: 18, completedByDay: week, streak: 5 }),
      ]),
    );

    // Five on Friday is the peak, so Friday is full height and the rest are
    // measured against it.
    expect(email.html).toContain('height:64px');
    // A day nobody finished anything still gets a stub, or the week reads as a
    // missing column rather than a quiet Thursday.
    expect(email.html).toContain('height:3px');
    for (const label of ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']) {
      expect(email.html).toContain(label);
    }
    expect(email.html).toContain('day streak');
    expect(email.text).toContain('5 days in a row.');
  });

  it('keeps a one day streak to itself', async () => {
    const email = await renderGroup(
      group('weekly_review', [summary({ kind: 'weekly_review', streak: 1, today: [item()] })]),
    );

    // A one day streak is a day.
    expect(email.html).not.toContain('day streak');
    expect(email.text).not.toContain('in a row');
  });

  it('counts what got done today in the evening nudge', async () => {
    const email = await renderGroup(
      group('overdue_nudge', [
        summary({ kind: 'overdue_nudge', overdue: [item()], completedToday: 4, openTotal: 9 }),
      ]),
    );

    expect(email.html).toContain('done today');
    expect(email.text).toContain('4 done today, 9 tasks open');
  });

  it('renders a payload frozen before any of this existed', async () => {
    // A delivery claimed before 0013 and retried after it. Every new field is
    // absent rather than empty, which is the case the optional types are for.
    const old = {
      kind: 'daily_digest' as const,
      localDate: '2026-09-01',
      today: [
        {
          id: 'a',
          title: 'Water the plants',
          dueDate: '2026-09-01',
          dueTime: '18:00:00',
          priority: 0,
          project: 'Garden',
          planned: false,
        },
      ],
      overdue: [],
      dueSoon: [],
      completedThisWeek: 3,
      openTotal: 4,
    };

    const email = await renderGroup(group('daily_digest', [old]));

    expect(email.subject).toBe('Water the plants, and nothing else today');
    expect(email.html).toContain('Water the plants');
    expect(email.html).toContain('Garden');
    // No project colour in that payload, so the dot falls back to the neutral one.
    expect(email.html).toContain('#CDC3B4');
  });

  it('describes a single task reminder as fully as a list line', async () => {
    const email = await renderGroup(
      group('task_reminder', [
        task({ estimate: 20, tags: ['calls'], subtasks: { done: 0, total: 2 } }),
      ]),
    );

    expect(email.html).toContain('0 of 2 done · 20m · #calls');
    expect(email.text).toContain('(Garden, 0 of 2 done, 20m, #calls)');
  });
});

describe('every email', () => {
  it('carries a preheader, so the inbox preview is not the first link', async () => {
    const email = await renderGroup(group('daily_digest', [summary({ today: [item()] })]));
    // Hidden, and ahead of everything else in the body. Without it the inbox
    // preview shows whatever text comes first, which is the wordmark link.
    const body = email.html.slice(email.html.indexOf('<body'));
    const preheader = body.indexOf('1 task today');
    expect(preheader).toBeGreaterThan(-1);
    expect(preheader).toBeLessThan(body.indexOf('Tend'));
    expect(email.html).toContain('display:none');
  });

  it('signs the unsubscribe link with the token version from settings', async () => {
    const email = await renderGroup(group('daily_digest', [summary()]));
    // Every grouped email has one. Only the sign-in code goes without.
    const token = email.unsubscribeUrl!.split('t=')[1]!;
    const claims = JSON.parse(
      Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'),
    ) as { email: string; kind: string; version: number };

    expect(claims).toEqual({ email: 'me@example.com', kind: 'daily_digest', version: 2 });
  });
});
