import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, bootPostgres, createUsers } from './testing/postgres';

/**
 * `capture_email`, against a real Postgres.
 *
 * What is under test is the cap and the reuse. An inbound address is guessable
 * and unauthenticated by construction, so the sender check in the route is the
 * only thing in front of this, and the cap is what stops a mistake there
 * becoming a thousand rows.
 */

let pg: PGlite;
const USER = '00000000-0000-4000-8000-00000000aa11';
const OTHER = '00000000-0000-4000-8000-00000000aa12';

async function one<T>(query: string, params: unknown[] = []): Promise<T | undefined> {
  return (await pg.query<T>(query, params)).rows[0];
}

const item = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    feed_uid: 'mail:msg_abc123',
    title: 'Read chapter 4',
    due_date: '2026-09-22',
    priority: 3,
    notes: 'Pages 90 to 140.',
    ...over,
  });

const capture = (payload = item(), user = USER) =>
  one<{ capture_email: string }>(
    'select public.capture_email($1, $2::jsonb) as capture_email',
    [user, payload],
  ).then((row) => row!.capture_email);

beforeAll(async () => {
  pg = await bootPostgres();
  await createUsers(pg, [USER, OTHER]);
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await asSuperuser(pg);
  await pg.query('delete from public.tasks where user_id = any($1)', [[USER, OTHER]]);
});

describe('capturing a mail', () => {
  it('lands it in the inbox with everything the subject carried', async () => {
    expect(await capture()).toBe('inserted');

    const row = await one<{
      title: string;
      status: string;
      priority: number;
      due_date: Date;
      notes: string;
    }>('select title, status, priority, due_date, notes from public.tasks where user_id = $1', [
      USER,
    ]);

    expect(row).toMatchObject({ title: 'Read chapter 4', status: 'inbox', priority: 3 });
    expect(row!.due_date.toISOString().slice(0, 10)).toBe('2026-09-22');
    expect(row!.notes).toBe('Pages 90 to 140.');
  });

  it('leaves one row when the webhook is retried', async () => {
    // Resend retries on any non-2xx, so this is the ordinary case rather than
    // an edge. The message id is the identity and the unique index does the
    // work.
    expect(await capture()).toBe('inserted');
    expect(await capture()).toBe('updated');

    const count = await one<{ n: number }>(
      'select count(*)::int as n from public.tasks where user_id = $1',
      [USER],
    );
    expect(count!.n).toBe(1);
  });

  it('does not bring back a capture you deleted', async () => {
    await capture();
    await pg.query('update public.tasks set deleted_at = now() where user_id = $1', [USER]);
    expect(await capture()).toBe('deleted');
  });

  it('refuses a priority outside the range rather than writing it', async () => {
    // The column has a CHECK, and a rejected insert would fail the whole
    // webhook. Clamped to none instead.
    expect(await capture(item({ priority: 9 }))).toBe('inserted');
    const row = await one<{ priority: number }>(
      'select priority from public.tasks where user_id = $1',
      [USER],
    );
    expect(row!.priority).toBe(0);
  });

  it('takes a mail with no date at all', async () => {
    expect(await capture(item({ due_date: '', due_time: '' }))).toBe('inserted');
    const row = await one<{ due_date: Date | null }>(
      'select due_date from public.tasks where user_id = $1',
      [USER],
    );
    expect(row!.due_date).toBeNull();
  });

  it('stops at the daily cap', async () => {
    // 50 a day. Past that something is wrong, and the rows are the only
    // evidence of what.
    for (let i = 0; i < 50; i += 1) {
      expect(await capture(item({ feed_uid: `mail:bulk-${i}` }))).toBe('inserted');
    }
    expect(await capture(item({ feed_uid: 'mail:one-too-many' }))).toBe('over the daily cap');

    const count = await one<{ n: number }>(
      'select count(*)::int as n from public.tasks where user_id = $1',
      [USER],
    );
    expect(count!.n).toBe(50);
  });

  it('counts the cap per account, not globally', async () => {
    for (let i = 0; i < 50; i += 1) await capture(item({ feed_uid: `mail:bulk-${i}` }));
    expect(await capture(item({ feed_uid: 'mail:theirs' }), OTHER)).toBe('inserted');
  });

  it('does not count typed tasks against the cap', async () => {
    // Only captures. A busy day of real work must not silently switch mail off.
    for (let i = 0; i < 60; i += 1) {
      await pg.query(
        `insert into public.tasks (id, user_id, title, sort_key)
         values (gen_random_uuid(), $1, 'typed', 'a0')`,
        [USER],
      );
    }
    expect(await capture()).toBe('inserted');
  });
});

describe('the capture function', () => {
  it('is callable by no session role', async () => {
    const row = await one<{ acl: string | null }>(
      `select array_to_string(proacl, ' ') as acl from pg_proc where proname = 'capture_email'`,
    );
    const acl = row!.acl ?? '';
    expect(acl).not.toContain('authenticated=X/');
    expect(acl).not.toContain('anon=X/');
  });
});
