import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaimResponse, ReminderKind } from '@/lib/email/types';

/**
 * The route's orchestration, with a fake Supabase and no network.
 *
 * What is under test is the part neither the SQL suite nor the render suite can
 * reach: that a claim becomes the right number of notifications, that each group
 * is settled exactly once, and that a send which throws marks its rows failed
 * rather than losing them. `EMAIL_MODE=console` runs the real render and the real
 * send path with nothing leaving the process.
 *
 * Since 0014 a group can go out on two channels, and the rule worth holding is
 * that one working channel settles the row. A push that lands is a reminder
 * delivered even if the mail bounced off a guard, and the reverse holds for
 * somebody with email off. Only a group where everything failed is failed.
 */

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

let calls: RpcCall[] = [];
let claim: ClaimResponse;
/** Subscription rows the fake `push_subscriptions` table hands back. */
let subscriptions: { id: string; endpoint: string; p256dh: string; auth: string; failures: number }[] = [];
let deleted: string[] = [];
/** What the mocked web-push does. */
let pushBehaviour: 'ok' | 'gone' | 'throw' = 'ok';

const table = () => {
  const answer = { data: subscriptions, error: null };
  const chain = {
    select: () => ({ eq: async () => answer }),
    update: () => ({ eq: async () => ({ error: null }) }),
    delete: () => ({
      in: async (_column: string, ids: string[]) => {
        deleted.push(...ids);
        return { error: null };
      },
    }),
  };
  return chain;
};

const supabase = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'claim_reminder_batch') return { data: claim, error: null };
    return { data: null, error: null };
  },
  from: () => table(),
};

vi.mock('@/lib/supabase/admin', () => ({ getAdminSupabase: () => supabase }));

class FakeWebPushError extends Error {
  constructor(readonly statusCode: number) {
    super(`push service said ${statusCode}`);
  }
}

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async () => {
      if (pushBehaviour === 'gone') throw new FakeWebPushError(410);
      if (pushBehaviour === 'throw') throw new Error('push service unreachable');
      return { statusCode: 201 };
    },
  },
  WebPushError: FakeWebPushError,
}));

const { POST } = await import('./route');

let count = 0;

const EMAIL_ONLY = { email: true, push: false };

function delivery(
  kind: ReminderKind,
  minutes = 0,
  channels: { email: boolean; push: boolean } = EMAIL_ONLY,
) {
  count += 1;
  const base = Date.parse('2026-09-01T13:00:00Z');
  const task = {
    id: `t${count}`,
    title: `Task ${count}`,
    notes: '',
    dueDate: '2026-09-01',
    dueTime: '09:00:00',
    priority: 0,
    project: null,
  };

  return {
    id: `d${count}`,
    userId: 'u1',
    kind,
    email: channels.email ? 'me@example.com' : null,
    channels,
    scheduledAt: new Date(base + minutes * 60_000).toISOString(),
    dedupeKey: `k${count}`,
    attempts: 1,
    timezone: 'America/New_York',
    tokenVersion: 1,
    payload:
      kind === 'task_reminder'
        ? { kind, task }
        : {
            kind,
            localDate: '2026-09-01',
            today: [{ ...task, planned: false }],
            overdue: [],
            dueSoon: [],
            completedThisWeek: 0,
            openTotal: 1,
          },
  } as ClaimResponse['claimed'][number];
}

function request(secret = 'the-cron-secret') {
  return new Request('http://localhost:3000/api/cron/reminders', {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
  });
}

const rpc = (name: string) => calls.filter((call) => call.name === name);

beforeEach(() => {
  calls = [];
  count = 0;
  subscriptions = [];
  deleted = [];
  pushBehaviour = 'ok';
  claim = { claimed: [], skipped: 0, quotaAvailable: true };
  vi.stubEnv('CRON_SECRET', 'the-cron-secret');
  vi.stubEnv('EMAIL_MODE', 'console');
  vi.stubEnv('EMAIL_TOKEN_SECRET', 'a-long-random-string');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tend.example.com');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the door', () => {
  it('refuses a request without the secret, and says nothing useful', async () => {
    const response = await POST(request('wrong'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'not authorized' });
    // Nothing was claimed, so nothing can be stranded by a probe.
    expect(calls).toEqual([]);
  });

  it('refuses everything when no secret is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await POST(request())).status).toBe(401);
  });
});

describe('a claim', () => {
  it('sends one email for reminders inside the window and settles both rows', async () => {
    claim = {
      claimed: [delivery('task_reminder', 0), delivery('task_reminder', 3)],
      skipped: 0,
      quotaAvailable: true,
    };

    const response = await POST(request());
    const body = (await response.json()) as { groups: number; sent: number };

    expect(body.groups).toBe(1);
    expect(body.sent).toBe(2);

    const sent = rpc('mark_reminders_sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args.p_ids).toEqual(['d1', 'd2']);
    // Console mode has no provider id, so the row records the mode and the key it
    // would have used, which is what makes a log readable after the fact.
    expect(sent[0]!.args.p_message_id).toBe('console:k1');
  });

  it('keeps a digest and a reminder apart', async () => {
    claim = {
      claimed: [delivery('task_reminder'), delivery('daily_digest', 1)],
      skipped: 0,
      quotaAvailable: true,
    };

    const body = (await POST(request())).json();
    expect((await body).groups).toBe(2);
    expect(rpc('mark_reminders_sent')).toHaveLength(2);
  });

  it('marks a failed send failed rather than losing it', async () => {
    // A refused domain is the guard doing its job, and from the route's side it is
    // the same shape as Resend being down.
    vi.stubEnv('EMAIL_MODE', 'live');
    vi.stubEnv('EMAIL_ALLOW_LIVE', 'true');
    vi.stubEnv('EMAIL_ALLOWED_DOMAINS', 'nowhere.test');
    claim = { claimed: [delivery('daily_digest')], skipped: 0, quotaAvailable: true };

    const response = await POST(request());
    const body = (await response.json()) as { failed: number; failures: string[] };

    // Reported as a 200 with a count: pg_net cannot act on a 500, and the row
    // already carries the reason.
    expect(response.status).toBe(200);
    expect(body.failed).toBe(1);
    expect(body.failures[0]).toMatch(/refusing to send/);

    const failed = rpc('mark_reminders_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.args.p_ids).toEqual(['d1']);
    expect(rpc('mark_reminders_sent')).toHaveLength(0);
  });

  it('leaves a heartbeat even when there was nothing to do', async () => {
    const response = await POST(request());
    const body = (await response.json()) as { claimed: number };

    expect(body.claimed).toBe(0);
    const beat = rpc('record_cron_heartbeat');
    expect(beat).toHaveLength(1);
    expect(beat[0]!.args.p_name).toBe('reminders_route');
    // The heartbeat is the only proof the HTTP call landed. pg_net is fire and
    // forget, so an empty run still has to say so.
    expect(beat[0]!.args.p_detail).toMatchObject({ claimed: 0, sent: 0, failed: 0 });
  });

  it('passes the quota answer through, so a spent day is visible', async () => {
    claim = { claimed: [], skipped: 3, quotaAvailable: false };
    const body = (await (await POST(request())).json()) as {
      skipped: number;
      quotaAvailable: boolean;
    };

    expect(body).toMatchObject({ skipped: 3, quotaAvailable: false });
  });
});

describe('two channels', () => {
  const subscribed = () => {
    subscriptions = [
      { id: 's1', endpoint: 'https://push.example/1', p256dh: 'key', auth: 'secret', failures: 0 },
    ];
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'a-public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'a-private-key');
  };

  it('settles a push-only group with no email at all', async () => {
    subscribed();
    claim = {
      claimed: [delivery('daily_digest', 0, { email: false, push: true })],
      skipped: 0,
      quotaAvailable: true,
    };

    const body = (await (await POST(request())).json()) as { sent: number; pushed: number };
    expect(body).toMatchObject({ sent: 1, pushed: 1 });

    const sent = rpc('mark_reminders_sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args.p_message_id).toBe('push:1');
  });

  it('sends both when both are open', async () => {
    subscribed();
    claim = {
      claimed: [delivery('daily_digest', 0, { email: true, push: true })],
      skipped: 0,
      quotaAvailable: true,
    };

    const body = (await (await POST(request())).json()) as { sent: number; pushed: number };
    expect(body).toMatchObject({ sent: 1, pushed: 1 });
    // The email answered first, so its receipt is the one on the row.
    expect(rpc('mark_reminders_sent')[0]!.args.p_message_id).toBe('console:k1');
  });

  it('still settles the row when the email fails and the push lands', async () => {
    // The rule this file exists for. A person who got the notification was
    // reminded, and failing the row would have them reminded again tomorrow.
    subscribed();
    vi.stubEnv('EMAIL_MODE', 'live');
    vi.stubEnv('EMAIL_ALLOW_LIVE', 'true');
    vi.stubEnv('EMAIL_ALLOWED_DOMAINS', 'nowhere.test');
    claim = {
      claimed: [delivery('daily_digest', 0, { email: true, push: true })],
      skipped: 0,
      quotaAvailable: true,
    };

    const body = (await (await POST(request())).json()) as {
      sent: number;
      failed: number;
      failures: string[];
    };

    expect(body).toMatchObject({ sent: 1, failed: 0 });
    expect(rpc('mark_reminders_failed')).toHaveLength(0);
    // Reported anyway. A half outcome that says nothing is how a broken channel
    // stays broken for a month.
    expect(body.failures[0]).toMatch(/^email: /);
  });

  it('fails the row when every channel fails', async () => {
    subscribed();
    pushBehaviour = 'throw';
    vi.stubEnv('EMAIL_MODE', 'live');
    vi.stubEnv('EMAIL_ALLOW_LIVE', 'true');
    vi.stubEnv('EMAIL_ALLOWED_DOMAINS', 'nowhere.test');
    claim = {
      claimed: [delivery('daily_digest', 0, { email: true, push: true })],
      skipped: 0,
      quotaAvailable: true,
    };

    const body = (await (await POST(request())).json()) as { failed: number; failures: string[] };
    expect(body.failed).toBe(1);
    expect(rpc('mark_reminders_sent')).toHaveLength(0);
    const reason = rpc('mark_reminders_failed')[0]!.args.p_error as string;
    expect(reason).toMatch(/email: /);
    expect(reason).toMatch(/push: /);
  });

  it('drops a subscription the push service says is gone', async () => {
    subscribed();
    pushBehaviour = 'gone';
    claim = {
      claimed: [delivery('daily_digest', 0, { email: false, push: true })],
      skipped: 0,
      quotaAvailable: true,
    };

    const body = (await (await POST(request())).json()) as { failed: number };
    // 410 means that browser is never coming back, so the row goes rather than
    // failing on every tick forever.
    expect(deleted).toEqual(['s1']);
    expect(body.failed).toBe(1);
  });

  it('sends no push and reports nothing when the deployment has no keys', async () => {
    // Push is additive. An install with no VAPID pair has to behave exactly as it
    // did before, which means an email-only claim and a clean summary.
    subscriptions = [
      { id: 's1', endpoint: 'https://push.example/1', p256dh: 'key', auth: 'secret', failures: 0 },
    ];
    claim = {
      claimed: [delivery('daily_digest', 0, { email: true, push: true })],
      skipped: 0,
      quotaAvailable: true,
    };

    const body = (await (await POST(request())).json()) as {
      sent: number;
      pushed: number;
      failures?: string[];
    };
    expect(body).toMatchObject({ sent: 1, pushed: 0 });
    expect(body.failures).toBeUndefined();
  });
});
