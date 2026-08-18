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

function group(kind: ReminderKind, payloads: ClaimedDelivery['payload'][]): EmailGroup {
  return {
    kind,
    email: 'me@example.com',
    timezone: 'America/New_York',
    tokenVersion: 2,
    deliveries: payloads.map((payload, index) => ({
      id: `d${index}`,
      kind,
      email: 'me@example.com',
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
  it('counts the day in the subject', async () => {
    const email = await renderGroup(
      group('daily_digest', [
        summary({
          today: [item(), item({ id: 'b', title: 'Call the bank' })],
          overdue: [item({ id: 'c', title: 'Renew the passport', dueDate: '2026-08-28' })],
        }),
      ]),
    );

    expect(email.subject).toBe('Today: 2 tasks, 1 late');
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

    expect(email.subject).toBe('Today: nothing due');
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
  it('counts what is late', async () => {
    const email = await renderGroup(
      group('overdue_nudge', [
        summary({
          kind: 'overdue_nudge',
          overdue: [item({ dueDate: '2026-08-20' }), item({ id: 'b', dueDate: '2026-08-21' })],
        }),
      ]),
    );

    expect(email.subject).toBe('2 tasks past due');
    expect(email.text).toContain('Late:');
  });

  it('counts what got done', async () => {
    const email = await renderGroup(
      group('weekly_review', [
        summary({ kind: 'weekly_review', completedThisWeek: 12, openTotal: 5 }),
      ]),
    );

    expect(email.subject).toBe('Last week: 12 tasks done');
    expect(email.text).toContain('12 tasks done, 5 tasks open');
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
    const token = email.unsubscribeUrl.split('t=')[1]!;
    const claims = JSON.parse(
      Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'),
    ) as { email: string; kind: string; version: number };

    expect(claims).toEqual({ email: 'me@example.com', kind: 'daily_digest', version: 2 });
  });
});
