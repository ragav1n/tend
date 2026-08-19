import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, asUser, bootPostgres, createUsers } from '@/lib/sync/testing/postgres';

/**
 * The reminder pipeline, run against a real Postgres.
 *
 * All of it is SQL, which is the whole reason it is testable at this level: the
 * schedule, the timezone conversion, the dedupe, the claim and the caps are
 * functions rather than application code, so PGlite can execute the same thing
 * production runs. The route handler that follows only renders and sends.
 *
 * Every instant here is a literal. A test that computes its expectation with the
 * same expression as the code under test proves only that the expression is
 * itself, so the offsets below are written out: New York is UTC-4 in September
 * and UTC-5 in December, and getting that from tzdata is the point.
 */

let pg: PGlite;
let users = 0;
let tasks = 0;

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  const result = await pg.query<T>(query, params);
  return result.rows;
}

async function one<T>(query: string, params: unknown[] = []): Promise<T> {
  const [row] = await rows<T>(query, params);
  return row!;
}

/** A signed-up user with settings. Defaults to New York, so DST is in play. */
async function newUser(settings: Record<string, string | number | boolean> = {}) {
  users += 1;
  const id = `00000000-0000-4000-8000-${String(users).padStart(12, '0')}`;
  await createUsers(pg, [id]);

  const patch = { timezone: 'America/New_York', ...settings };
  const assignments = Object.keys(patch)
    .map((column, index) => `${column} = $${index + 2}`)
    .join(', ');
  await pg.query(`update public.user_settings set ${assignments} where user_id = $1`, [
    id,
    ...Object.values(patch),
  ]);

  // That update queues a user-wide recompute. Cleared so a test's own drain
  // counts what the test did rather than what its setup did.
  await pg.query('delete from public.notification_recompute_queue where user_id = $1', [id]);
  return id;
}

async function newTask(
  userId: string,
  over: {
    title?: string;
    dueDate?: string | null;
    dueTime?: string | null;
    plannedFor?: string | null;
    status?: string;
  } = {},
) {
  tasks += 1;
  const id = `11111111-0000-4000-8000-${String(tasks).padStart(12, '0')}`;
  await pg.query(
    `insert into public.tasks (id, user_id, title, status, due_date, due_time, planned_for, sort_key)
     values ($1, $2, $3, $4, $5, $6, $7, 'a0')`,
    [
      id,
      userId,
      over.title ?? 'Water the plants',
      over.status ?? 'active',
      over.dueDate ?? null,
      over.dueTime ?? null,
      over.plannedFor ?? null,
    ],
  );
  return id;
}

interface Delivery {
  id: string;
  kind: string;
  status: string;
  scheduled_at: Date;
  local_date: string | null;
  dedupe_key: string;
  reason: string | null;
  last_error: string | null;
  attempts: number;
  payload: Record<string, unknown> | null;
}

function deliveries(userId: string, kind?: string): Promise<Delivery[]> {
  return rows<Delivery>(
    `select * from public.reminder_deliveries
      where user_id = $1 and ($2::text is null or kind = $2)
      order by scheduled_at, dedupe_key`,
    [userId, kind ?? null],
  );
}

const at = (delivery: Delivery) => delivery.scheduled_at.toISOString();
/** Postgres hands a date column back as a Date at UTC midnight. */
const day = (value: Date | string | null) =>
  value === null ? null : new Date(value).toISOString().slice(0, 10);

function shiftDay(from: string, by: number): string {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

/** Today where the user is standing, which is what a digest is about. */
async function localToday(userId: string): Promise<string> {
  const row = await one<{ d: Date }>(
    `select (now() at time zone u.timezone)::date as d
       from public.user_settings u where u.user_id = $1`,
    [userId],
  );
  return day(row.d)!;
}

let keys = 0;

/**
 * A delivery that is due right now.
 *
 * Written straight in rather than enqueued, because the claim path answers "what
 * is due" and the predicates that decide when a row appears are tested on their
 * own above. Going through an enqueue here would tie every claim test to the
 * hour the suite happens to run at.
 */
async function dueDelivery(
  userId: string,
  kind = 'daily_digest',
  taskId: string | null = null,
): Promise<string> {
  keys += 1;
  const row = await one<{ id: string }>(
    `insert into public.reminder_deliveries
       (user_id, kind, task_id, scheduled_at, local_date, dedupe_key)
     values ($1, $2, $3, now() - interval '1 minute',
             (now() at time zone (select timezone from public.user_settings where user_id = $1))::date,
             $4)
     returning id`,
    [userId, kind, taskId, `test:${keys}`],
  );
  return row.id;
}

beforeAll(async () => {
  pg = await bootPostgres();
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await asSuperuser(pg);
});

describe('recomputing one task', () => {
  it("schedules the reminder at the due instant in the user's zone", async () => {
    const user = await newUser();
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });

    const count = await one<{ recompute_task_notifications: number }>(
      'select public.recompute_task_notifications($1) as recompute_task_notifications',
      [task],
    );
    expect(count.recompute_task_notifications).toBe(1);

    const [row] = await deliveries(user);
    // September in New York is UTC-4.
    expect(at(row!)).toBe('2026-09-01T13:00:00.000Z');
    expect(row!.status).toBe('pending');
    expect(row!.dedupe_key).toBe(`ti:${task}:202609011300`);
  });

  it('follows tzdata into winter rather than holding an offset', async () => {
    const user = await newUser();
    const task = await newTask(user, { dueDate: '2026-12-01', dueTime: '09:00' });
    await pg.query('select public.recompute_task_notifications($1)', [task]);

    const [row] = await deliveries(user);
    // December is UTC-5. One stored offset would have sent this an hour early
    // for half the year.
    expect(at(row!)).toBe('2026-12-01T14:00:00.000Z');
  });

  it('uses the all-day time when the task has no due time', async () => {
    const user = await newUser({ all_day_reminder_time: '08:30' });
    const task = await newTask(user, { dueDate: '2026-09-01' });
    await pg.query('select public.recompute_task_notifications($1)', [task]);

    const [row] = await deliveries(user);
    expect(at(row!)).toBe('2026-09-01T12:30:00.000Z');
  });

  it('takes the lead time off the due instant', async () => {
    const user = await newUser({ reminder_lead_minutes: 30 });
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });
    await pg.query('select public.recompute_task_notifications($1)', [task]);

    const [row] = await deliveries(user);
    expect(at(row!)).toBe('2026-09-01T12:30:00.000Z');
  });

  it('pushes a reminder inside quiet hours to the end of them', async () => {
    const user = await newUser({
      quiet_hours_enabled: true,
      quiet_start: '22:00',
      quiet_end: '07:00',
    });
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '23:30' });
    await pg.query('select public.recompute_task_notifications($1)', [task]);

    const [row] = await deliveries(user);
    // 23:30 local is inside the window, so it waits for 07:00 the next morning.
    expect(at(row!)).toBe('2026-09-02T11:00:00.000Z');
  });

  it('prefers the explicit reminders on a task over the implicit one', async () => {
    const user = await newUser();
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });
    await pg.query(
      `insert into public.task_reminders (id, user_id, task_id, offset_minutes) values
         ('22222222-0000-4000-8000-000000000001', $1, $2, -60),
         ('22222222-0000-4000-8000-000000000002', $1, $2, -1440)`,
      [user, task],
    );

    await pg.query('select public.recompute_task_notifications($1)', [task]);

    const found = await deliveries(user);
    expect(found.map(at)).toEqual(['2026-08-31T13:00:00.000Z', '2026-09-01T12:00:00.000Z']);
    // Named after the reminder rather than the task, so editing one offset
    // cannot collide with another.
    expect(found.every((row) => row.dedupe_key.startsWith('tr:'))).toBe(true);
  });

  it('schedules nothing for an instant that has already passed', async () => {
    const user = await newUser();
    const task = await newTask(user, { dueDate: '2020-01-01', dueTime: '09:00' });
    await pg.query('select public.recompute_task_notifications($1)', [task]);

    expect(await deliveries(user)).toHaveLength(0);
  });

  it('schedules nothing when reminders are turned off', async () => {
    const user = await newUser({ reminders_enabled: false });
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });
    await pg.query('select public.recompute_task_notifications($1)', [task]);

    expect(await deliveries(user)).toHaveLength(0);
  });

  it('leaves one row however many times it runs', async () => {
    const user = await newUser();
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });
    for (let i = 0; i < 5; i += 1) {
      await pg.query('select public.recompute_task_notifications($1)', [task]);
    }
    // An offline batch can queue the same recompute many times over. The dedupe
    // key is what makes that free.
    expect(await deliveries(user)).toHaveLength(1);
  });

  it('refuses to touch a task belonging to somebody else', async () => {
    const owner = await newUser();
    const other = await newUser();
    const task = await newTask(owner, { dueDate: '2026-09-01', dueTime: '09:00' });

    await asUser(pg, other);
    await expect(
      pg.query('select public.recompute_task_notifications($1)', [task]),
    ).rejects.toThrow(/belongs to somebody else/);
  });
});

describe('the recompute queue', () => {
  it('picks up a task the moment it is saved', async () => {
    const user = await newUser();
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });

    // The insert trigger only marks work. Nothing exists until the drain.
    expect(await deliveries(user)).toHaveLength(0);
    const queued = await rows(
      'select 1 from public.notification_recompute_queue where task_id = $1',
      [task],
    );
    expect(queued).toHaveLength(1);

    await pg.query('select public.drain_notification_recompute(500)');
    expect(await deliveries(user)).toHaveLength(1);
  });

  it('drops the pending reminder when the task is completed', async () => {
    const user = await newUser();
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });
    await pg.query('select public.drain_notification_recompute(500)');
    expect(await deliveries(user)).toHaveLength(1);

    await pg.query(`update public.tasks set status = 'done' where id = $1`, [task]);
    await pg.query('select public.drain_notification_recompute(500)');

    expect(await deliveries(user)).toHaveLength(0);
  });

  it('moves every reminder when the timezone changes', async () => {
    const user = await newUser();
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });
    await pg.query('select public.drain_notification_recompute(500)');
    expect(at((await deliveries(user))[0]!)).toBe('2026-09-01T13:00:00.000Z');

    // Zero task rows change, which is the point of storing wall clock.
    await pg.query(`update public.user_settings set timezone = 'Asia/Kolkata' where user_id = $1`, [
      user,
    ]);
    expect(await deliveries(user)).toHaveLength(0);

    await pg.query('select public.drain_notification_recompute(500)');
    const [row] = await deliveries(user);
    expect(at(row!)).toBe('2026-09-01T03:30:00.000Z');
    void task;
  });
});

describe('the daily digest', () => {
  const enqueue = (asOf: string) =>
    one<{ enqueue_daily_digests: number }>(
      'select public.enqueue_daily_digests($1::timestamptz) as enqueue_daily_digests',
      [asOf],
    );

  it('waits until the local clock passes the digest time', async () => {
    const user = await newUser({ digest_time: '07:00' });

    // 10:00 UTC is 06:00 in New York, so not yet.
    await enqueue('2026-09-01T10:00:00Z');
    expect(await deliveries(user, 'daily_digest')).toHaveLength(0);

    await enqueue('2026-09-01T11:30:00Z');
    const found = await deliveries(user, 'daily_digest');
    expect(found).toHaveLength(1);
    expect(day(found[0]!.local_date)).toBe('2026-09-01');
    expect(found[0]!.dedupe_key).toBe(`dd:${user}:2026-09-01`);
  });

  it('sends one per local day however many ticks run', async () => {
    const user = await newUser({ digest_time: '07:00' });
    for (const asOf of ['2026-09-01T12:00:00Z', '2026-09-01T13:00:00Z', '2026-09-02T02:00:00Z']) {
      await enqueue(asOf);
    }
    // The third instant is still 2026-09-01 in New York, which is why the key is
    // the local date rather than the UTC one.
    expect(await deliveries(user, 'daily_digest')).toHaveLength(1);
  });

  it('catches up on the morning the clocks go forward', async () => {
    const user = await newUser({ digest_time: '04:00' });
    // 2026-03-08 is spring forward in New York: 02:00 never happens. A predicate
    // written as equality against a local time would skip the day.
    await enqueue('2026-03-08T12:00:00Z');
    expect(await deliveries(user, 'daily_digest')).toHaveLength(1);
  });

  it('sends nothing when digests are off', async () => {
    const user = await newUser({ digest_enabled: false });
    await enqueue('2026-09-01T20:00:00Z');
    expect(await deliveries(user, 'daily_digest')).toHaveLength(0);
  });

  it('sends nothing when email is off entirely', async () => {
    const user = await newUser({ email_enabled: false });
    await enqueue('2026-09-01T20:00:00Z');
    expect(await deliveries(user, 'daily_digest')).toHaveLength(0);
  });
});

describe('the overdue nudge', () => {
  const enqueue = (asOf: string) =>
    pg.query('select public.enqueue_overdue_nudges($1::timestamptz)', [asOf]);

  it('says nothing when nothing is late', async () => {
    const user = await newUser({ nudge_time: '18:00' });
    await newTask(user, { dueDate: '2026-12-01' });
    await enqueue('2026-09-01T23:00:00Z');
    expect(await deliveries(user, 'overdue_nudge')).toHaveLength(0);
  });

  it('fires once a day when something is late', async () => {
    const user = await newUser({ nudge_time: '18:00' });
    await newTask(user, { dueDate: '2026-08-20' });

    // 23:00 UTC is 19:00 in New York, past the nudge time.
    await enqueue('2026-09-01T23:00:00Z');
    await enqueue('2026-09-01T23:30:00Z');
    const found = await deliveries(user, 'overdue_nudge');
    expect(found).toHaveLength(1);
    expect(found[0]!.dedupe_key).toBe(`on:${user}:2026-09-01`);
  });
});

describe('the weekly review', () => {
  const enqueue = (asOf: string) =>
    pg.query('select public.enqueue_weekly_reviews($1::timestamptz)', [asOf]);

  it('fires on the chosen day and once per ISO week', async () => {
    // 2026-09-06 is a Sunday, which is ISO day 7.
    const user = await newUser({ weekly_review_day: 7, weekly_review_time: '17:00' });

    await enqueue('2026-09-05T22:00:00Z');
    expect(await deliveries(user, 'weekly_review')).toHaveLength(0);

    await enqueue('2026-09-06T21:00:00Z');
    await enqueue('2026-09-06T22:00:00Z');
    expect(await deliveries(user, 'weekly_review')).toHaveLength(1);

    await enqueue('2026-09-13T21:00:00Z');
    const found = await deliveries(user, 'weekly_review');
    expect(found).toHaveLength(2);
    expect(found.map((row) => row.dedupe_key)).toEqual([
      `wr:${user}:2026-36`,
      `wr:${user}:2026-37`,
    ]);
  });
});

describe('claiming a batch', () => {
  const claim = (limit = 25) =>
    one<{ claim_reminder_batch: { claimed: Record<string, unknown>[]; skipped: number; quotaAvailable: boolean } }>(
      'select public.claim_reminder_batch($1) as claim_reminder_batch',
      [limit],
    );

  beforeEach(async () => {
    // One claim is global by design, so every test here starts from an empty
    // queue and an unspent day.
    await pg.query('delete from public.reminder_deliveries');
    await pg.query('delete from public.email_quota_days');
    await pg.query('delete from public.email_suppressions');
  });

  it('hands back the frozen payload and marks the row claimed', async () => {
    const user = await newUser();
    const today = await localToday(user);
    await newTask(user, { title: 'Repot the ficus', dueDate: shiftDay(today, -1) });
    await newTask(user, { title: 'Water the plants', plannedFor: today });
    await dueDelivery(user);

    const answer = (await claim()).claim_reminder_batch;

    expect(answer.claimed).toHaveLength(1);
    const claimed = answer.claimed[0] as {
      email: string;
      kind: string;
      attempts: number;
      payload: { overdue: { title: string }[]; today: { title: string }[]; openTotal: number };
    };
    expect(claimed.kind).toBe('daily_digest');
    expect(claimed.email).toBe(`${user}@example.com`);
    expect(claimed.attempts).toBe(1);
    expect(claimed.payload.overdue.map((item) => item.title)).toEqual(['Repot the ficus']);
    expect(claimed.payload.today.map((item) => item.title)).toEqual(['Water the plants']);
    expect(claimed.payload.openTotal).toBe(2);

    const [row] = await deliveries(user, 'daily_digest');
    expect(row!.status).toBe('claimed');
    // Frozen at claim time, so a retry renders the same email even if the task
    // changed in between.
    expect(row!.payload).not.toBeNull();
  });

  it('skips a suppressed address', async () => {
    const user = await newUser();
    await pg.query(
      `insert into public.email_suppressions (email, reason) values ($1, 'hard bounce')`,
      [`${user}@example.com`],
    );
    await dueDelivery(user);

    const answer = (await claim()).claim_reminder_batch;
    expect(answer.claimed).toHaveLength(0);
    const [row] = await deliveries(user, 'daily_digest');
    expect(row!.status).toBe('skipped');
    expect(row!.reason).toBe('suppressed');
  });

  it('cancels a delivery whose task has gone', async () => {
    const user = await newUser();
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });
    await dueDelivery(user, 'task_reminder', task);
    await pg.query(`update public.tasks set deleted_at = now() where id = $1`, [task]);

    const answer = (await claim()).claim_reminder_batch;
    expect(answer.claimed).toHaveLength(0);
    const [row] = await deliveries(user, 'task_reminder');
    expect(row!.status).toBe('cancelled');
    expect(row!.reason).toBe('nothing left to say');
  });

  it('stops at the per-user daily cap and says so', async () => {
    const user = await newUser({ max_reminder_emails_per_day: 0 });
    const task = await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });
    await dueDelivery(user, 'task_reminder', task);

    const answer = (await claim()).claim_reminder_batch;
    expect(answer.claimed).toHaveLength(0);
    const [row] = await deliveries(user, 'task_reminder');
    // Visible rather than silent: a reminder that was never sent has to be
    // findable, or the app is lying about what it did.
    expect(row!.status).toBe('skipped');
    expect(row!.reason).toBe('over the daily cap');
  });

  it('leaves work pending when the account is out of quota for the day', async () => {
    const user = await newUser();
    await pg.query(
      `insert into public.email_quota_days (day, reserved)
       values (current_date, public.email_daily_ceiling())
       on conflict (day) do update set reserved = public.email_daily_ceiling()`,
    );
    await dueDelivery(user);

    const answer = (await claim()).claim_reminder_batch;
    expect(answer.claimed).toHaveLength(0);
    expect(answer.quotaAvailable).toBe(false);
    // Pending, not failed. Tomorrow's allowance carries it.
    const [row] = await deliveries(user, 'daily_digest');
    expect(row!.status).toBe('pending');
  });
});

describe('settling a batch', () => {
  async function claimedDigest() {
    await pg.query('delete from public.reminder_deliveries');
    await pg.query('delete from public.email_quota_days');
    const user = await newUser();
    const id = await dueDelivery(user);
    await pg.query('select public.claim_reminder_batch(25)');
    return { user, id };
  }

  it('marks the group sent, and a replay changes nothing', async () => {
    const { user, id } = await claimedDigest();

    const first = await one<{ mark_reminders_sent: number }>(
      'select public.mark_reminders_sent($1::uuid[], $2) as mark_reminders_sent',
      [[id], 'resend-1'],
    );
    expect(first.mark_reminders_sent).toBe(1);

    const again = await one<{ mark_reminders_sent: number }>(
      'select public.mark_reminders_sent($1::uuid[], $2) as mark_reminders_sent',
      [[id], 'resend-2'],
    );
    // Only a claimed row can be marked sent, so the second call is a no-op
    // rather than a second email.
    expect(again.mark_reminders_sent).toBe(0);

    const [row] = await deliveries(user, 'daily_digest');
    expect(row!.status).toBe('sent');
  });

  it('returns a failure to the queue until the attempts run out', async () => {
    const { user, id } = await claimedDigest();

    await pg.query('select public.mark_reminders_failed($1::uuid[], $2)', [[id], 'resend down']);
    let [row] = await deliveries(user, 'daily_digest');
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(1);

    // attempts is spent at claim time, so a process that dies mid-send is
    // bounded rather than looping.
    await pg.query(`update public.reminder_deliveries set status = 'claimed', attempts = 3
                     where id = $1`, [id]);
    await pg.query('select public.mark_reminders_failed($1::uuid[], $2)', [[id], 'resend down']);
    [row] = await deliveries(user, 'daily_digest');
    expect(row!.status).toBe('failed');
    expect(row!.last_error).toBe('resend down');
  });

  it('reaps a claim nobody ever settled', async () => {
    const { user, id } = await claimedDigest();
    await pg.query(
      `update public.reminder_deliveries set claimed_at = now() - interval '10 minutes'
        where id = $1`,
      [id],
    );

    const reaped = await one<{ reap_stale_reminder_claims: number }>(
      'select public.reap_stale_reminder_claims() as reap_stale_reminder_claims',
    );
    expect(reaped.reap_stale_reminder_claims).toBeGreaterThan(0);

    const [row] = await deliveries(user, 'daily_digest');
    expect(row!.status).toBe('pending');
  });
});

describe('the nightly repair', () => {
  const reconcile = () =>
    one<{ reconcile_notifications: { rebuilt: number; cancelled: number } }>(
      'select public.reconcile_notifications() as reconcile_notifications',
    );

  it('rebuilds a reminder whose mark the queue lost', async () => {
    const user = await newUser();
    const task = await newTask(user, {
      dueDate: day(new Date(Date.now() + 86_400_000))!,
      dueTime: '09:00',
    });

    // An unlogged table is truncated by an unclean restart, which is exactly this:
    // the mark is gone and nothing else knows the task changed.
    await pg.query('delete from public.notification_recompute_queue');
    await pg.query('select public.drain_notification_recompute(500)');
    expect(await deliveries(user, 'task_reminder')).toHaveLength(0);

    const answer = await reconcile();
    expect(answer.reconcile_notifications.rebuilt).toBeGreaterThan(0);
    expect(await deliveries(user, 'task_reminder')).toHaveLength(1);
    void task;
  });

  it('cancels a pending reminder for work that is already done', async () => {
    const user = await newUser();
    const task = await newTask(user, {
      dueDate: day(new Date(Date.now() + 86_400_000))!,
      dueTime: '09:00',
    });
    await pg.query('select public.drain_notification_recompute(500)');
    expect(await deliveries(user, 'task_reminder')).toHaveLength(1);

    // Completed with the queue emptied behind it, so the trigger's mark is lost.
    await pg.query(`update public.tasks set status = 'done' where id = $1`, [task]);
    await pg.query('delete from public.notification_recompute_queue');

    await reconcile();
    const [row] = await deliveries(user, 'task_reminder');
    expect(row!.status).toBe('cancelled');
    expect(row!.reason).toBe('task closed');
  });

  it('lands on the same schedule when run twice', async () => {
    const user = await newUser();
    await newTask(user, {
      dueDate: day(new Date(Date.now() + 86_400_000))!,
      dueTime: '09:00',
    });
    await reconcile();
    const before = await deliveries(user, 'task_reminder');
    await reconcile();
    const after = await deliveries(user, 'task_reminder');

    // The row itself is rebuilt rather than left alone, because a pending row is
    // deleted and re-derived: a cancelled one would keep its dedupe_key and block
    // the identical row. What has to hold is the schedule, and that a second run
    // cannot turn one reminder into two.
    expect(after).toHaveLength(1);
    expect(after[0]!.dedupe_key).toBe(before[0]!.dedupe_key);
    expect(at(after[0]!)).toBe(at(before[0]!));
  });

  it('leaves a claimed row alone rather than resurrecting it as pending', async () => {
    const user = await newUser();
    await newTask(user, {
      dueDate: day(new Date(Date.now() + 86_400_000))!,
      dueTime: '09:00',
    });
    await reconcile();
    const [row] = await deliveries(user, 'task_reminder');
    await pg.query(
      `update public.reminder_deliveries set status = 'sent', sent_at = now() where id = $1`,
      [row!.id],
    );

    await reconcile();

    // The email has gone. The dedupe_key is what stops the rebuild sending it
    // again, which is the whole reason the key is derived from inputs.
    const found = await deliveries(user, 'task_reminder');
    expect(found).toHaveLength(1);
    expect(found[0]!.status).toBe('sent');
  });
});

describe('the tick', () => {
  it('reports what it did and leaves a heartbeat', async () => {
    const user = await newUser({ digest_time: '04:00' });
    await newTask(user, { dueDate: '2026-09-01', dueTime: '09:00' });

    const answer = await one<{
      notifications_tick: {
        reaped: number;
        drained: number;
        digests: number;
        due: number;
        posted: boolean;
      };
    }>('select public.notifications_tick() as notifications_tick');

    expect(answer.notifications_tick.drained).toBeGreaterThan(0);
    // No pg_net here, so the tick does the SQL and skips the call rather than
    // failing the whole run.
    expect(answer.notifications_tick.posted).toBe(false);

    const [beat] = await rows<{ name: string; detail: Record<string, unknown> }>(
      `select name, detail from public.cron_heartbeats where name = 'notifications_tick'`,
    );
    expect(beat!.detail.drained).toBe(answer.notifications_tick.drained);
  });
});

describe('what a session can reach', () => {
  it('hides deliveries belonging to another account', async () => {
    const owner = await newUser();
    const other = await newUser();
    const id = await dueDelivery(owner);

    await asUser(pg, other);
    expect(await rows('select id from public.reminder_deliveries where id = $1', [id]))
      .toHaveLength(0);

    await asUser(pg, owner);
    expect(await rows('select id from public.reminder_deliveries where id = $1', [id]))
      .toHaveLength(1);
  });

  it('refuses the claim, the tick and the enqueues outright', async () => {
    const user = await newUser();
    await asUser(pg, user);

    for (const call of [
      'select public.claim_reminder_batch(5)',
      'select public.notifications_tick()',
      'select public.enqueue_daily_digests()',
      'select public.mark_reminders_sent(array[]::uuid[], $$x$$)',
      "select public.notifications_secret('tend_cron_secret')",
    ]) {
      await expect(pg.query(call), call).rejects.toThrow(/permission denied|does not exist/);
    }
  });
});
