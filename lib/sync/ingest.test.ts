import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, asUser as userRole, bootPostgres, createUsers } from './testing/postgres';

/**
 * `ingest_task`, against a real Postgres.
 *
 * Three rules, each of which is a way an import ruins the thing it was meant to
 * help. Importing twice must not duplicate; a task you deleted must stay
 * deleted; and your own edits must survive the next import. All three are only
 * provable by running the function, which is why this is PGlite rather than a
 * grep.
 */

let pg: PGlite;
const USER = '00000000-0000-4000-8000-00000000fee1';
const COURSE = '20000000-0000-4000-8000-0000000feed1';

async function one<T>(query: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await pg.query<T>(query, params);
  return result.rows[0];
}

function item(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    feed_uid: 'event-assignment-1@canvas',
    title: 'Project 1',
    due_date: '2026-09-14',
    due_time: '23:59',
    course_id: COURSE,
    notes: 'From the feed',
    ...over,
  });
}

const ingest = (payload = item()) =>
  one<{ ingest_task: string }>('select public.ingest_task($1, $2::jsonb) as ingest_task', [
    USER,
    payload,
  ]).then((row) => row!.ingest_task);

interface Row {
  id: string;
  title: string;
  due_date: Date | null;
  due_time: string | null;
  course_id: string | null;
  deleted_at: Date | null;
  feed_snapshot: Record<string, unknown>;
}

const fetchRow = (uid = 'event-assignment-1@canvas') =>
  one<Row>('select * from public.tasks where user_id = $1 and feed_uid = $2', [USER, uid]);

beforeAll(async () => {
  pg = await bootPostgres();
  await createUsers(pg, [USER]);
  await pg.query(
    `insert into public.courses (id, user_id, code, sort_key) values ($1, $2, 'CS 6035', 'a0')`,
    [COURSE, USER],
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await asSuperuser(pg);
  await pg.query('delete from public.tasks where user_id = $1', [USER]);
  await pg.query('delete from public.activity_log where user_id = $1', [USER]);
});

describe('importing a feed item', () => {
  it('creates the task, filed under its course', async () => {
    expect(await ingest()).toBe('inserted');

    const row = (await fetchRow())!;
    expect(row.title).toBe('Project 1');
    expect(row.course_id).toBe(COURSE);
    expect(row.due_time).toBe('23:59:00');
  });

  it('writes an activity entry, so the import can be undone', async () => {
    await ingest();
    const entry = await one<{ action: string; summary: string }>(
      'select action, summary from public.activity_log where user_id = $1',
      [USER],
    );
    expect(entry!.action).toBe('create');
    expect(entry!.summary).toContain('Project 1');
  });

  it('leaves one row however many times the feed is read', async () => {
    // Rule 1. A nightly cron reads the same feed every night.
    expect(await ingest()).toBe('inserted');
    expect(await ingest()).toBe('updated');
    expect(await ingest()).toBe('updated');

    const count = await one<{ n: number }>(
      'select count(*)::int as n from public.tasks where user_id = $1',
      [USER],
    );
    expect(count!.n).toBe(1);
  });

  it('skips an item with no uid or no title', async () => {
    expect(await ingest(item({ feed_uid: '' }))).toBe('skipped');
    expect(await ingest(item({ title: '' }))).toBe('skipped');
  });

  it('imports an item that matched no course, rather than dropping it', async () => {
    // It lands unfiled, which is visible. Dropping it would be silent.
    expect(await ingest(item({ course_id: '' }))).toBe('inserted');
    expect((await fetchRow())!.course_id).toBeNull();
  });
});

describe('a task you deleted', () => {
  it('stays deleted, however many times the feed offers it again', async () => {
    // Rule 2. Without this, every dismissed assignment returns nightly and the
    // feature becomes something you switch off.
    await ingest();
    const row = (await fetchRow())!;
    await pg.query('update public.tasks set deleted_at = now() where id = $1', [row.id]);

    expect(await ingest()).toBe('deleted');
    expect(await ingest()).toBe('deleted');

    const after = (await fetchRow())!;
    expect(after.deleted_at).not.toBeNull();
  });

  it('holds the uid, so nothing can insert a second one under it', async () => {
    await ingest();
    const row = (await fetchRow())!;
    await pg.query('update public.tasks set deleted_at = now() where id = $1', [row.id]);

    // The unique index is unconditional on deleted_at, which is the mechanism
    // rather than a side effect.
    await expect(
      pg.query(
        `insert into public.tasks (id, user_id, title, feed_uid, sort_key)
         values (gen_random_uuid(), $1, 'Sneaky', $2, 'a0')`,
        [USER, 'event-assignment-1@canvas'],
      ),
    ).rejects.toThrow();
  });
});

describe('your own edits', () => {
  it('survive the next import', async () => {
    // Rule 3. The feed owns a field only while it still holds what the feed
    // last wrote.
    await ingest();
    const row = (await fetchRow())!;
    await pg.query(`update public.tasks set due_date = '2026-09-20' where id = $1`, [row.id]);

    // The feed now says the 16th. Your 20th stands.
    expect(await ingest(item({ due_date: '2026-09-16' }))).toBe('updated');
    const after = (await fetchRow())!;
    expect(after.due_date!.toISOString().slice(0, 10)).toBe('2026-09-20');
  });

  it('do not freeze the fields you left alone', async () => {
    await ingest();
    const row = (await fetchRow())!;
    await pg.query(`update public.tasks set due_date = '2026-09-20' where id = $1`, [row.id]);

    // The title is untouched, so the feed still owns it.
    await ingest(item({ due_date: '2026-09-16', title: 'Project 1 (revised)' }));
    const after = (await fetchRow())!;
    expect(after.title).toBe('Project 1 (revised)');
    expect(after.due_date!.toISOString().slice(0, 10)).toBe('2026-09-20');
  });

  it('lets the feed move a date you never touched', async () => {
    await ingest();
    await ingest(item({ due_date: '2026-09-16' }));
    const after = (await fetchRow())!;
    expect(after.due_date!.toISOString().slice(0, 10)).toBe('2026-09-16');
  });

  it('treats a cleared field as an edit rather than as unset', async () => {
    // `is distinct from` throughout, because null is a real value here: a due
    // time you deleted has to read as deleted.
    await ingest();
    const row = (await fetchRow())!;
    await pg.query('update public.tasks set due_time = null where id = $1', [row.id]);

    await ingest(item({ due_time: '09:00' }));
    expect((await fetchRow())!.due_time).toBeNull();
  });

  it('keeps a course you filed by hand', async () => {
    // The link is filled in but never taken away.
    await ingest(item({ course_id: '' }));
    const row = (await fetchRow())!;
    await pg.query('update public.tasks set course_id = $2 where id = $1', [row.id, COURSE]);

    await ingest(item({ course_id: '' }));
    expect((await fetchRow())!.course_id).toBe(COURSE);
  });

  it('records what it wrote, so the next import can tell', async () => {
    await ingest();
    const snapshot = (await fetchRow())!.feed_snapshot;
    expect(snapshot.title).toBe('Project 1');
    expect(snapshot.due_date).toBe('2026-09-14');
  });
});

describe('a course event', () => {
  const event = (over: Record<string, unknown> = {}) =>
    one<{ ingest_course_event: string }>(
      'select public.ingest_course_event($1, $2::jsonb) as ingest_course_event',
      [
        USER,
        JSON.stringify({
          feed_uid: 'event-calendar-event-9@canvas',
          title: 'Midterm Exam',
          starts_on: '2026-10-12',
          starts_at: '14:00',
          location: 'Klaus 1116',
          event_kind: 'exam',
          course_id: COURSE,
          ...over,
        }),
      ],
    ).then((row) => row!.ingest_course_event);

  beforeEach(async () => {
    await pg.query('delete from public.course_events where user_id = $1', [USER]);
  });

  it('lands, and lands once however often the feed is read', async () => {
    expect(await event()).toBe('applied');
    expect(await event()).toBe('applied');

    const rows = await pg.query<{ title: string; kind: string }>(
      'select title, kind from public.course_events where user_id = $1',
      [USER],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toEqual({ title: 'Midterm Exam', kind: 'exam' });
  });

  it('takes the feed word for it on a later read, having no local edits to keep', async () => {
    await event();
    await event({ title: 'Midterm Exam (moved)', starts_on: '2026-10-14' });

    const row = await one<{ title: string; starts_on: Date }>(
      'select title, starts_on from public.course_events where user_id = $1',
      [USER],
    );
    expect(row!.title).toBe('Midterm Exam (moved)');
    expect(row!.starts_on.toISOString().slice(0, 10)).toBe('2026-10-14');
  });

  it('skips an item with no date', async () => {
    expect(await event({ starts_on: '' })).toBe('skipped');
  });

  it('reads its kind from event_kind, not from the discriminator', async () => {
    // `kind` is what `import_feed` branches on. Reading it here stored every
    // exam as a plain event, which would have emptied the exam radar.
    await pg.query('delete from public.course_events where user_id = $1', [USER]);
    await one('select public.ingest_course_event($1, $2::jsonb)', [
      USER,
      JSON.stringify({
        kind: 'event',
        event_kind: 'exam',
        feed_uid: 'event-calendar-event-77@canvas',
        title: 'Final Exam',
        starts_on: '2026-12-10',
      }),
    ]);

    const row = await one<{ kind: string }>(
      'select kind from public.course_events where feed_uid = $1',
      ['event-calendar-event-77@canvas'],
    );
    expect(row!.kind).toBe('exam');
  });
});

describe('the ingest functions', () => {
  it('are callable by no session role', async () => {
    // Supabase grants execute to anon and authenticated on creation, and
    // `revoke ... from public` leaves a named grant untouched. Both of these
    // were callable by any signed-in session until this test said so.
    //
    // The owner's own grant stays and cannot be removed, so the assertion names
    // the two roles rather than forbidding execute outright.
    for (const name of ['ingest_task', 'ingest_course_event']) {
      const row = await one<{ acl: string | null }>(
        `select array_to_string(proacl, ' ') as acl
           from pg_proc where proname = $1`,
        [name],
      );
      const acl = row!.acl ?? '';
      expect(acl, name).not.toContain('authenticated=X/');
      expect(acl, name).not.toContain('anon=X/');
      expect(acl, `${name} keeps an owner grant`).toContain('postgres=X/');
    }
  });

  it('is not reachable through the RPC surface either', async () => {
    // Belt and braces: a signed-in session calling it directly must be refused
    // rather than merely discouraged.
    await pg.exec("set role authenticated");
    await expect(
      pg.query('select public.ingest_task($1, $2::jsonb)', [USER, item()]),
    ).rejects.toThrow();
    await pg.exec('reset role');
  });
});

describe('the door a session may use', () => {
  // The harness helper, which uses a session-level SET. `set_config(..., true)`
  // is transaction-local and the claims were gone by the time the function ran.
  const asUser = () => userRole(pg, USER);

  beforeEach(async () => {
    await asSuperuser(pg);
    await pg.query('delete from public.tasks where user_id = $1', [USER]);
    await pg.query('delete from public.course_events where user_id = $1', [USER]);
  });

  it('imports a batch under the caller own account', async () => {
    await asUser();
    const out = await one<{ import_feed: Record<string, number> }>(
      'select public.import_feed($1::jsonb) as import_feed',
      [
        JSON.stringify([
          JSON.parse(item()),
          JSON.parse(item({ feed_uid: 'event-assignment-2@canvas', title: 'Project 2' })),
          {
            kind: 'event',
            feed_uid: 'event-calendar-event-1@canvas',
            title: 'Lecture 1',
            starts_on: '2026-09-15',
          },
        ]),
      ],
    );
    await pg.exec('reset role');

    expect(out!.import_feed).toEqual({ inserted: 2, updated: 0, skipped: 0, events: 1 });
  });

  it('counts a re-read as updated rather than as news', async () => {
    await asUser();
    await pg.query('select public.import_feed($1::jsonb)', [JSON.stringify([JSON.parse(item())])]);
    const again = await one<{ import_feed: Record<string, number> }>(
      'select public.import_feed($1::jsonb) as import_feed',
      [JSON.stringify([JSON.parse(item())])],
    );
    await pg.exec('reset role');

    expect(again!.import_feed).toMatchObject({ inserted: 0, updated: 1 });
  });

  it('files everything under the caller, whatever the payload claims', async () => {
    // There is no argument to point at another account, which is the whole
    // reason this wrapper exists instead of granting ingest_task.
    await asUser();
    await pg.query('select public.import_feed($1::jsonb)', [
      JSON.stringify([JSON.parse(item({ user_id: '00000000-0000-4000-8000-0000000000ff' }))]),
    ]);
    await pg.exec('reset role');

    const row = await one<{ user_id: string }>(
      'select user_id from public.tasks where feed_uid = $1',
      ['event-assignment-1@canvas'],
    );
    expect(row!.user_id).toBe(USER);
  });

  it('refuses a caller with no session', async () => {
    await pg.exec(`reset role; set request.jwt.claims = ''; set role authenticated;`);
    await expect(
      pg.query('select public.import_feed($1::jsonb)', ['[]']),
    ).rejects.toThrow(/needs a session/);
    await asSuperuser(pg);
  });

  it('takes an empty batch without complaining', async () => {
    await asUser();
    const out = await one<{ import_feed: Record<string, number> }>(
      'select public.import_feed($1::jsonb) as import_feed',
      ['[]'],
    );
    await pg.exec('reset role');
    expect(out!.import_feed).toEqual({ inserted: 0, updated: 0, skipped: 0, events: 0 });
  });
});
