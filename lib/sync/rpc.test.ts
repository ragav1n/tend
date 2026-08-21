import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localToWire } from './mapping';
import {
  asSuperuser as ownerRole,
  asUser as userRole,
  bootPostgres,
  createUsers,
  migrationSql,
  MIGRATIONS,
} from './testing/postgres';

/**
 * The sync RPCs, executed against a real Postgres.
 *
 * The boot sequence lives in `testing/postgres.ts`: real migrations, real
 * plpgsql, real constraints, in-process. That matters because the two worst bugs
 * in this project so far were both in SQL that every other test happily ignored:
 * an insert that could not run at all, and a per-field merge nobody had ever
 * executed.
 *
 * Grep tests can tell you a policy is shaped correctly. Only this can tell you
 * the thing works.
 */

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

let db: PGlite;

const asUser = (uid: string) => userRole(db, uid);
const asSuperuser = () => ownerRole(db);

/** The exact payload push.ts builds for a new task. */
function insertMutation(over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? '11111111-1111-4111-8111-111111111111';
  const local = {
    id,
    // Phase 0 wrote 'local' here and the server must ignore it. Sending it is
    // the point of including it.
    userId: 'local',
    projectId: '',
    parentTaskId: '',
    seriesId: '',
    title: 'Buy oat milk',
    notes: '',
    status: 'active',
    priority: 0,
    dueDate: '2026-08-18',
    dueTime: null,
    startDate: null,
    plannedFor: null,
    estimateMinutes: null,
    cancelReason: null,
    archivedAt: null,
    sortKey: 'a0',
    plannedSortKey: 'a0',
    occurrenceDate: null,
    occurrenceSeq: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };

  return {
    mutationId: (over.mutationId as string) ?? '22222222-2222-4222-8222-222222222222',
    table: 'tasks',
    entityId: id,
    op: 'insert',
    patch: localToWire('tasks', local),
    baseVersion: 0,
  };
}

async function push(mutations: unknown[]) {
  const result = await db.query<{ sync_push: { results: unknown[]; cursor: number } }>(
    'select public.sync_push($1::jsonb) as sync_push',
    [JSON.stringify(mutations)],
  );
  return result.rows[0]!.sync_push;
}

async function pull(cursor = 0) {
  const result = await db.query<{
    sync_pull: { rows: { table: string; row: Record<string, unknown> }[]; cursor: number; hasMore: boolean };
  }>('select public.sync_pull($1, 500) as sync_pull', [cursor]);
  return result.rows[0]!.sync_pull;
}

beforeAll(async () => {
  db = await bootPostgres();
  await createUsers(db, [USER, OTHER]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('pushing an insert', () => {
  it('actually lands the row', async () => {
    // The regression. Before 0004 this raised on every task, because the insert
    // had no column list and mapped positionally onto two GENERATED ALWAYS
    // columns that accept no value at all.
    await asUser(USER);
    const response = await push([insertMutation()]);

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({ status: 'applied' });
    expect(response.cursor).toBeGreaterThan(0);

    await asSuperuser();
    const { rows } = await db.query<{ title: string; user_id: string; row_version: number }>(
      'select title, user_id, row_version from tasks',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Buy oat milk');
  });

  it('replaces the user_id the client sent', async () => {
    // The client writes 'local' before it has ever signed in, and user_id is on
    // the server-owned deny list precisely so that value can never be trusted.
    await asSuperuser();
    const { rows } = await db.query<{ user_id: string }>('select user_id from tasks');
    expect(rows[0]!.user_id).toBe(USER);
  });

  it('stamps the columns the client is forbidden from sending', async () => {
    await asSuperuser();
    const { rows } = await db.query<{
      row_version: number;
      updated_at: Date;
      field_versions: Record<string, number>;
      depth: number;
    }>('select row_version, updated_at, field_versions, depth from tasks');

    const row = rows[0]!;
    expect(row.row_version).toBeGreaterThan(0);
    expect(row.updated_at).toBeTruthy();
    expect(row.depth).toBe(0);
    // Every column gets a version on insert, so the first update from another
    // device has something to compare against.
    expect(row.field_versions.title).toBe(row.row_version);
  });

  it('turns the empty-string sentinels into real nulls', async () => {
    await asSuperuser();
    const { rows } = await db.query<{ project_id: string | null; parent_task_id: string | null }>(
      'select project_id, parent_task_id from tasks',
    );
    expect(rows[0]!.project_id).toBeNull();
    expect(rows[0]!.parent_task_id).toBeNull();
  });

  it('returns the original result for a replayed mutation', async () => {
    // A dropped ack must cost nothing. The retry finds its own mutation_id and
    // gets the first answer back rather than applying twice.
    await asUser(USER);
    const again = await push([insertMutation()]);
    expect(again.results[0]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query('select id from tasks');
    expect(rows).toHaveLength(1);
  });
});

describe('pulling', () => {
  it('sends the row back with its tag set inline', async () => {
    await asUser(USER);
    const page = await pull(0);

    const task = page.rows.find((r) => r.table === 'tasks');
    expect(task).toBeDefined();
    expect(task!.row.title).toBe('Buy oat milk');
    // task_tags is not its own channel, so the complete set rides on the task.
    expect(task!.row.tag_ids).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('excludes columns the client has no business seeing', async () => {
    await asUser(USER);
    const page = await pull(0);
    const task = page.rows.find((r) => r.table === 'tasks')!;

    expect(task.row).not.toHaveProperty('search_vector');
    expect(task.row).not.toHaveProperty('parent_depth');
    expect(task.row).not.toHaveProperty('user_id');
  });

  it('returns nothing above a current cursor', async () => {
    await asUser(USER);
    const page = await pull(0);
    const caughtUp = await pull(page.cursor);
    expect(caughtUp.rows).toHaveLength(0);
    // The cursor holds rather than advancing, so a row committing at a lower
    // version cannot be skipped.
    expect(caughtUp.cursor).toBe(page.cursor);
  });
});

describe('the per-field merge', () => {
  it('keeps both edits when two devices touch different fields', async () => {
    await asUser(USER);
    const base = (await pull(0)).rows.find((r) => r.table === 'tasks')!.row;
    const version = Number(base.row_version);

    // Device A retitles, from the version both devices last saw.
    await push([
      {
        mutationId: '33333333-3333-4333-8333-333333333333',
        table: 'tasks',
        entityId: base.id,
        op: 'update',
        patch: { title: 'Buy soy milk' },
        baseVersion: version,
      },
    ]);

    // Device B edits the notes, still from that same older version.
    const second = await push([
      {
        mutationId: '44444444-4444-4444-8444-444444444444',
        table: 'tasks',
        entityId: base.id,
        op: 'update',
        patch: { notes: 'the oat one was out' },
        baseVersion: version,
      },
    ]);

    expect(second.results[0]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query<{ title: string; notes: string }>(
      'select title, notes from tasks',
    );
    expect(rows[0]).toEqual({ title: 'Buy soy milk', notes: 'the oat one was out' });
  });

  it('keeps the server value and reports the loss when both touch one field', async () => {
    await asUser(USER);
    const base = (await pull(0)).rows.find((r) => r.table === 'tasks')!.row;

    // One below the version that last wrote the title, taken from the row rather
    // than guessed at. Zero would say something else entirely since 0006: that
    // the client has never seen a server version of this row at all.
    await asSuperuser();
    const { rows: stamped } = await db.query<{ title_version: string }>(
      `select (field_versions->>'title')::bigint as title_version from tasks where id = '${base.id}'`,
    );
    const stale = Number(stamped[0]!.title_version) - 1;
    await asUser(USER);

    const response = await push([
      {
        mutationId: '55555555-5555-4555-8555-555555555555',
        table: 'tasks',
        entityId: base.id,
        op: 'update',
        patch: { title: 'from a stale device' },
        baseVersion: stale,
      },
    ]);

    expect(response.results[0]).toMatchObject({
      status: 'merged',
      droppedFields: ['title'],
    });

    await asSuperuser();
    const { rows } = await db.query<{ title: string }>('select title from tasks');
    expect(rows[0]!.title).toBe('Buy soy milk');
  });
});

describe('row level security', () => {
  it('hides one user\'s rows from another', async () => {
    // The policies are the only thing standing between two accounts, so this
    // asserts the outcome rather than the shape of the policy. The other user
    // does get their own user_settings row, created by the signup trigger, and
    // seeing exactly that and nothing else is the correct answer.
    await asUser(OTHER);
    const page = await pull(0);
    expect(page.rows.filter((r) => r.table === 'tasks')).toHaveLength(0);
    expect(page.rows.map((r) => r.table)).toEqual(['user_settings']);
  });

  it('refuses an unauthenticated call outright', async () => {
    await db.exec(`set request.jwt.claims = ''; set role authenticated;`);
    await expect(pull(0)).rejects.toThrow(/not authenticated/);
    await asSuperuser();
  });

  it('will not let one user write a row onto another', async () => {
    await asUser(OTHER);
    await push([
      insertMutation({
        id: '99999999-9999-4999-8999-999999999999',
        mutationId: '66666666-6666-4666-8666-666666666666',
        title: 'belongs to other',
      }),
    ]);

    await asSuperuser();
    const { rows } = await db.query<{ user_id: string }>(
      "select user_id from tasks where title = 'belongs to other'",
    );
    expect(rows[0]!.user_id).toBe(OTHER);
  });
});

describe('soft delete', () => {
  it('tombstones rather than removing', async () => {
    await asUser(USER);
    const base = (await pull(0)).rows.find((r) => r.table === 'tasks')!.row;

    await push([
      {
        mutationId: '77777777-7777-4777-8777-777777777777',
        table: 'tasks',
        entityId: base.id,
        op: 'delete',
        patch: {},
        baseVersion: Number(base.row_version),
      },
    ]);

    await asSuperuser();
    const { rows } = await db.query<{ deleted_at: Date | null }>(
      `select deleted_at from tasks where id = '${base.id}'`,
    );
    // The row keeps its content for the retention window, so undelete is just
    // another field write.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deleted_at).not.toBeNull();
  });

  it('gives tasks no delete policy at all', async () => {
    // With no DELETE policy, RLS makes every row invisible to the statement, so
    // Postgres reports success having removed nothing. That silence is the
    // point: a client cannot destroy history even by trying.
    await asSuperuser();
    const before = await db.query('select id from tasks');
    expect(before.rows.length).toBeGreaterThan(0);

    await asUser(USER);
    await db.exec('delete from tasks');

    await asSuperuser();
    const after = await db.query('select id from tasks');
    expect(after.rows.length).toBe(before.rows.length);
  });
});

describe('what 0004 actually fixes', () => {
  /**
   * The same push against the schema as it stood before the fix. Two separate
   * failures were stacked here, and each one alone was enough to stop every
   * task reaching the server, which is why fixing the first changed nothing
   * visible.
   */
  it('fails without it', async () => {
    const old = await bootPostgres(['0001_core_schema', '0002_rls', '0003_sync_rpc']);
    try {
      await createUsers(old, [USER]);
      await userRole(old, USER);

      await expect(
        old.query('select public.sync_push($1::jsonb)', [
          JSON.stringify([insertMutation({ id: '88888888-8888-4888-8888-888888888888' })]),
        ]),
      ).rejects.toThrow();

      await old.exec('reset role');
      const { rows } = await old.query('select id from tasks');
      expect(rows).toHaveLength(0);
    } finally {
      await old.close();
    }
  }, 60_000);
});

describe('a row edited before its insert was ever acked', () => {
  it('keeps the edit instead of merging it away', async () => {
    /**
     * The client holds rowVersion 0 for a row it created and has never pulled
     * back, so every update it queues carries baseVersion 0. The insert stamps
     * field_versions well above that, so comparing the two drops every field of
     * every edit made before the first successful pull. Adding a task and then
     * fixing its title is the most ordinary thing anybody does offline, and
     * before 0006 the fix vanished with the server reporting a merge.
     */
    await asUser(USER);
    const id = '10101010-1010-4101-8101-101010101010';

    const response = await push([
      insertMutation({
        id,
        mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        title: 'Buy milk',
      }),
      {
        mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        table: 'tasks',
        entityId: id,
        op: 'update',
        patch: { title: 'Buy oat milk', notes: 'the barista one' },
        baseVersion: 0,
      },
    ]);

    expect(response.results[1]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query<{ title: string; notes: string }>(
      `select title, notes from tasks where id = '${id}'`,
    );
    expect(rows[0]).toEqual({ title: 'Buy oat milk', notes: 'the barista one' });
  });

  it('still protects a field from a device that has fallen behind', async () => {
    // The version the client sends is what decides this. Zero means "I have
    // never seen a server version of this row", which only its author can say.
    await asUser(USER);
    const id = '10101010-1010-4101-8101-101010101010';
    const { rows: before } = await db.query<{ row_version: number }>(
      `select row_version from tasks where id = '${id}'`,
    );

    const response = await push([
      {
        mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
        table: 'tasks',
        entityId: id,
        op: 'update',
        patch: { title: 'from a device that missed the last pull' },
        baseVersion: Number(before[0]!.row_version) - 1,
      },
    ]);

    expect(response.results[0]).toMatchObject({ status: 'merged', droppedFields: ['title'] });
  });
});

describe('the settings row', () => {
  /**
   * A singleton keyed by user_id, with no id column, no tombstone and a client
   * that calls it 'me'. Every one of those is a place the generic push path
   * would have raised, and it was not in sync_writable_tables() at all until
   * 0007, so a settings change came back fatal and died in the deadletter.
   */
  const settings = (patch: Record<string, unknown>, mutationId: string, baseVersion = 0) => ({
    mutationId,
    table: 'user_settings',
    entityId: 'me',
    op: 'update',
    patch,
    baseVersion,
  });

  it('applies an update keyed by the user rather than by an id', async () => {
    await asUser(USER);
    const response = await push([
      settings(
        { timezone: 'America/New_York', digest_time: '06:30' },
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      ),
    ]);

    expect(response.results[0]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query<{ timezone: string; digest_time: string }>(
      `select timezone, digest_time from user_settings where user_id = '${USER}'`,
    );
    expect(rows[0]).toEqual({ timezone: 'America/New_York', digest_time: '06:30:00' });
  });

  it('leaves the settings of the other account alone', async () => {
    await asSuperuser();
    const { rows } = await db.query<{ timezone: string }>(
      `select timezone from user_settings where user_id = '${OTHER}'`,
    );
    expect(rows[0]!.timezone).toBe('UTC');
  });

  it('refuses an insert, because signup owns the row', async () => {
    await asUser(USER);
    await expect(
      push([
        {
          mutationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
          table: 'user_settings',
          entityId: 'me',
          op: 'insert',
          patch: { timezone: 'Asia/Kolkata' },
          baseVersion: 0,
        },
      ]),
    ).rejects.toThrow(/created at signup/);
  });

  it('refuses a delete, because there is nothing to tombstone', async () => {
    await asUser(USER);
    await expect(
      push([
        {
          mutationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
          table: 'user_settings',
          entityId: 'me',
          op: 'delete',
          patch: {},
          baseVersion: 0,
        },
      ]),
    ).rejects.toThrow(/no tombstone/);
  });

  it('sends it down the pull with the user column stripped', async () => {
    await asUser(USER);
    const page = await pull(0);
    const row = page.rows.find((r) => r.table === 'user_settings')!.row;

    expect(row.timezone).toBe('America/New_York');
    expect(row).not.toHaveProperty('user_id');
    // No id column at all, which is why the client keys it locally by a constant.
    expect(row).not.toHaveProperty('id');
  });
});

describe('focus sessions', () => {
  /**
   * A synced table added long after the push path was written, which is the
   * point of the test: 0016 adds the table and one name to
   * sync_writable_tables(), and if the generic path really is generic that is
   * all it should need.
   */
  const SESSION = '33333333-3333-4333-8333-333333333331';

  const session = (patch: Record<string, unknown>, mutationId: string, op = 'insert') => ({
    mutationId,
    table: 'focus_sessions',
    entityId: SESSION,
    op,
    patch,
    baseVersion: 0,
  });

  it('lands a session opened against a task', async () => {
    await asUser(USER);
    const response = await push([
      session(
        localToWire('focus_sessions', {
          id: SESSION,
          userId: 'local',
          taskId: '11111111-1111-4111-8111-111111111111',
          startedAt: '2026-08-19T14:03:00.000Z',
          endedAt: null,
          plannedMinutes: 25,
          focusedSeconds: 0,
          createdAt: '2026-08-19T14:03:00.000Z',
          deletedAt: null,
        }),
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      ),
    ]);

    expect(response.results[0]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query<{ user_id: string; focused_seconds: number }>(
      `select user_id, focused_seconds from focus_sessions where id = '${SESSION}'`,
    );
    // The client sent 'local' as the user, and the server ignores it.
    expect(rows[0]).toEqual({ user_id: USER, focused_seconds: 0 });
  });

  it('finishes it with an update, which is what a pause and a stop both send', async () => {
    await asUser(USER);
    const response = await push([
      session(
        { focused_seconds: 1500, ended_at: '2026-08-19T14:28:00.000Z' },
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
        'update',
      ),
    ]);

    expect(response.results[0]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query<{ focused_seconds: number; ended_at: Date }>(
      `select focused_seconds, ended_at from focus_sessions where id = '${SESSION}'`,
    );
    expect(rows[0]!.focused_seconds).toBe(1500);
    expect(rows[0]!.ended_at).not.toBeNull();
  });

  it('sends it down the pull under its own table name', async () => {
    await asUser(USER);
    const page = await pull(0);
    const row = page.rows.find((r) => r.table === 'focus_sessions')!.row;

    expect(row.id).toBe(SESSION);
    expect(row.focused_seconds).toBe(1500);
    expect(row).not.toHaveProperty('user_id');
  });

  it('keeps a session with no task, since most of them have none', async () => {
    const loose = '33333333-3333-4333-8333-333333333332';
    await asUser(USER);
    const response = await push([
      {
        mutationId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
        table: 'focus_sessions',
        entityId: loose,
        op: 'insert',
        // The client's '' sentinel has to arrive as a real null, or Postgres
        // rejects it as a uuid and the whole table stops syncing.
        patch: localToWire('focus_sessions', {
          id: loose,
          taskId: '',
          startedAt: '2026-08-19T15:00:00.000Z',
          plannedMinutes: 50,
          focusedSeconds: 0,
          createdAt: '2026-08-19T15:00:00.000Z',
          deletedAt: null,
        }),
        baseVersion: 0,
      },
    ]);

    expect(response.results[0]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query<{ task_id: string | null }>(
      `select task_id from focus_sessions where id = '${loose}'`,
    );
    expect(rows[0]!.task_id).toBeNull();
  });

  it('refuses one written against another account', async () => {
    await asUser(OTHER);
    await expect(
      db.query(
        `insert into focus_sessions (id, user_id, started_at)
         values ('33333333-3333-4333-8333-333333333333', '${USER}', now())`,
      ),
    ).rejects.toThrow();
  });
});

describe('a child whose parent is not there', () => {
  /**
   * 0017. focus_sessions is the first table pointing at a parent that can be
   * superseded, so this is the first time a foreign key violation was reachable
   * from an ordinary sequence of events. It used to abort the whole sync_push
   * call, and the client settles a raised error across the entire claimed batch,
   * so one unsendable row killed every unrelated edit queued behind it.
   */
  const GHOST = '44444444-4444-4444-8444-444444444441';
  const SESSION = '44444444-4444-4444-8444-444444444442';
  const TAG = '44444444-4444-4444-8444-444444444443';

  it('drops the row and lets the rest of the batch commit', async () => {
    await asUser(USER);
    const response = await push([
      {
        mutationId: '44444444-4444-4444-8444-44444444444a',
        table: 'focus_sessions',
        entityId: SESSION,
        op: 'insert',
        patch: {
          id: SESSION,
          task_id: GHOST,
          started_at: '2026-08-19T16:00:00.000Z',
          planned_minutes: 25,
          focused_seconds: 60,
        },
        baseVersion: 0,
      },
      {
        mutationId: '44444444-4444-4444-8444-44444444444b',
        table: 'tags',
        entityId: TAG,
        op: 'insert',
        patch: { id: TAG, name: 'innocent', color: '#C29B72', sort_key: 'a0' },
        baseVersion: 0,
      },
    ]);

    expect(response.results[0]).toMatchObject({ status: 'missing' });
    // The whole point: the mutation queued behind it still applied.
    expect(response.results[1]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const sessions = await db.query(`select id from focus_sessions where id = '${SESSION}'`);
    const tags = await db.query(`select id from tags where id = '${TAG}'`);
    expect(sessions.rows).toHaveLength(0);
    expect(tags.rows).toHaveLength(1);
  });

  it('is remembered, so a retry answers the same thing rather than raising', async () => {
    await asUser(USER);
    const again = await push([
      {
        mutationId: '44444444-4444-4444-8444-44444444444a',
        table: 'focus_sessions',
        entityId: SESSION,
        op: 'insert',
        patch: { id: SESSION, task_id: GHOST, started_at: '2026-08-19T16:00:00.000Z' },
        baseVersion: 0,
      },
    ]);
    expect(again.results[0]).toMatchObject({ status: 'missing' });
  });

  it('still lets a session through when its task is real', async () => {
    await asUser(USER);
    const good = '44444444-4444-4444-8444-444444444444';
    const response = await push([
      {
        mutationId: '44444444-4444-4444-8444-44444444444c',
        table: 'focus_sessions',
        entityId: good,
        op: 'insert',
        patch: {
          id: good,
          task_id: '11111111-1111-4111-8111-111111111111',
          started_at: '2026-08-19T17:00:00.000Z',
          planned_minutes: 25,
          focused_seconds: 0,
        },
        baseVersion: 0,
      },
    ]);
    expect(response.results[0]).toMatchObject({ status: 'applied' });
  });
});

describe('the activity log', () => {
  const ENTRY = '55555555-5555-4555-8555-555555555551';
  const GROUP = '55555555-5555-4555-8555-5555555555f0';
  const GHOST = '99999999-9999-4999-8999-999999999999';

  const entry = (patch: Record<string, unknown>, mutationId: string, op = 'insert') => ({
    mutationId,
    table: 'activity_log',
    entityId: ENTRY,
    op,
    patch,
    baseVersion: 0,
  });

  it('lands an entry', async () => {
    await asUser(USER);
    const response = await push([
      entry(
        localToWire('activity_log', {
          id: ENTRY,
          userId: 'local',
          action: 'update',
          entityTable: 'tasks',
          entityId: '11111111-1111-4111-8111-111111111111',
          groupId: GROUP,
          before: { priority: 0 },
          after: { priority: 3 },
          summary: 'Edited "Buy oat milk"',
          undoneAt: null,
          createdAt: '2026-08-20T09:00:00.000Z',
          deletedAt: null,
        }),
        '55555555-5555-4555-8555-55555555500a',
      ),
    ]);

    expect(response.results[0]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query<{ user_id: string; action: string; before: unknown }>(
      `select user_id, action, before from activity_log where id = '${ENTRY}'`,
    );
    // The client sent 'local' as the user, and the server ignores it.
    expect(rows[0]).toEqual({ user_id: USER, action: 'update', before: { priority: 0 } });
  });

  it('marks it undone with an update, which is all undo sends', async () => {
    await asUser(USER);
    const response = await push([
      entry({ undone_at: '2026-08-20T09:05:00.000Z' }, '55555555-5555-4555-8555-55555555500b', 'update'),
    ]);

    expect(response.results[0]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query<{ undone_at: Date | null }>(
      `select undone_at from activity_log where id = '${ENTRY}'`,
    );
    expect(rows[0]!.undone_at).not.toBeNull();
  });

  it('comes back through sync_pull', async () => {
    await asUser(USER);
    const page = await pull(0);
    const row = page.rows.find((r) => r.table === 'activity_log')?.row as
      | Record<string, unknown>
      | undefined;
    expect(row).toBeDefined();
    expect(row!.group_id).toBe(GROUP);
    // user_id is stripped on the way out, the same as every other table.
    expect(row).not.toHaveProperty('user_id');
  });

  /**
   * The one place in the schema with no foreign key on the thing it points at.
   * A log entry outliving its task is what a log is, and 0017 is the reminder
   * of what the alternative costs: a foreign_key_violation takes the whole
   * claimed batch to the deadletter.
   */
  it('accepts an entry about a task that is not there', async () => {
    await asUser(USER);
    const orphan = '55555555-5555-4555-8555-555555555552';
    const response = await push([
      {
        mutationId: '55555555-5555-4555-8555-55555555500c',
        table: 'activity_log',
        entityId: orphan,
        op: 'insert',
        patch: {
          id: orphan,
          action: 'delete',
          entity_table: 'tasks',
          entity_id: GHOST,
          group_id: GROUP,
          summary: 'Deleted "gone"',
        },
        baseVersion: 0,
      },
    ]);
    expect(response.results[0]).toMatchObject({ status: 'applied' });
  });

  it('refuses an action it does not know without taking the batch down', async () => {
    await asUser(USER);
    const bad = '55555555-5555-4555-8555-555555555553';
    const response = await push([
      {
        mutationId: '55555555-5555-4555-8555-55555555500d',
        table: 'activity_log',
        entityId: bad,
        op: 'insert',
        patch: {
          id: bad,
          action: 'obliterate',
          entity_id: GHOST,
          group_id: GROUP,
        },
        baseVersion: 0,
      },
      // An innocent row queued behind it. Before the check_violation branch in
      // 0018 this whole call raised and neither landed, which is 0017's bug
      // wearing a different error code.
      {
        mutationId: '55555555-5555-4555-8555-55555555500e',
        table: 'activity_log',
        entityId: '55555555-5555-4555-8555-555555555554',
        op: 'insert',
        patch: {
          id: '55555555-5555-4555-8555-555555555554',
          action: 'create',
          entity_id: GHOST,
          group_id: GROUP,
          summary: 'Added "something"',
        },
        baseVersion: 0,
      },
    ]);
    expect(response.results[0]).toMatchObject({ status: 'rejected' });
    expect(response.results[1]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query(
      `select id from activity_log where id = '55555555-5555-4555-8555-555555555554'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses a bad value in an update the same way', async () => {
    await asUser(USER);
    const response = await push([
      entry({ action: 'obliterate' }, '55555555-5555-4555-8555-55555555500f', 'update'),
    ]);
    expect(response.results[0]).toMatchObject({ status: 'rejected' });
  });

  it('keeps one account out of another account\'s history', async () => {
    await asUser(OTHER);
    const { rows } = await db.query(`select id from activity_log where id = '${ENTRY}'`);
    expect(rows).toEqual([]);
  });
});

describe('areas and projects', () => {
  const AREA = '66666666-6666-4666-8666-666666666661';
  const PROJECT = '66666666-6666-4666-8666-666666666662';

  function areaMutation(over: Record<string, unknown> = {}) {
    const id = (over.id as string) ?? AREA;
    return {
      mutationId: (over.mutationId as string) ?? '66666666-6666-4666-8666-6666666666a1',
      table: 'areas',
      entityId: id,
      op: 'insert',
      patch: localToWire('areas', {
        id,
        userId: 'local',
        name: 'House',
        sortKey: 'a0',
        createdAt: '2026-08-20T00:00:00.000Z',
        deletedAt: null,
        ...over,
      }),
      baseVersion: 0,
    };
  }

  function projectMutation(over: Record<string, unknown> = {}) {
    const id = (over.id as string) ?? PROJECT;
    return {
      mutationId: (over.mutationId as string) ?? '66666666-6666-4666-8666-6666666666a2',
      table: 'projects',
      entityId: id,
      op: 'insert',
      patch: localToWire('projects', {
        id,
        userId: 'local',
        // The sentinel the local store carries for "no area". Postgres rejects
        // '' as a uuid outright, so this is the case SENTINEL_COLUMNS exists for.
        areaId: '',
        name: 'Kitchen',
        notes: '',
        status: 'active',
        color: '#C29B72',
        dueDate: null,
        sortKey: 'a0',
        archivedAt: null,
        createdAt: '2026-08-20T00:00:00.000Z',
        deletedAt: null,
        ...over,
      }),
      baseVersion: 0,
    };
  }

  /**
   * The row's current counter, read back rather than guessed.
   *
   * baseVersion drives the per-field merge, so a hardcoded number in a file
   * where earlier cases already bumped the row means the field gets dropped as
   * stale and the assertion fails for a reason that has nothing to do with what
   * it is testing.
   */
  async function versionOf(table: string, id: string): Promise<number> {
    const { rows } = await db.query<{ row_version: number }>(
      `select row_version from ${table} where id = $1`,
      [id],
    );
    return Number(rows[0]?.row_version ?? 0);
  }

  async function setStatus(status: string, mutationId: string) {
    await asSuperuser();
    const baseVersion = await versionOf('projects', PROJECT);
    await asUser(USER);
    return push([
      { mutationId, table: 'projects', entityId: PROJECT, op: 'update', patch: { status }, baseVersion },
    ]);
  }

  async function completedAt(id = PROJECT): Promise<Date | null> {
    await asSuperuser();
    const { rows } = await db.query<{ completed_at: Date | null }>(
      `select completed_at from projects where id = $1`,
      [id],
    );
    return rows[0]?.completed_at ?? null;
  }

  it('lands an area, which nothing had ever pushed before', async () => {
    await asUser(USER);
    const response = await push([areaMutation()]);
    expect(response.results[0]).toMatchObject({ status: 'applied' });

    await asSuperuser();
    const { rows } = await db.query<{ name: string }>(
      `select name from areas where id = '${AREA}'`,
    );
    expect(rows[0]?.name).toBe('House');
  });

  it('files a project under it, and sends both back on a pull', async () => {
    await asUser(USER);
    await push([projectMutation({ areaId: AREA })]);

    const page = await pull(0);
    expect(new Set(page.rows.map((r) => r.table)).has('areas')).toBe(true);
    const project = page.rows.find((r) => r.table === 'projects' && r.row.id === PROJECT);
    expect(project?.row.area_id).toBe(AREA);
  });

  it('turns the empty-string area back into a real null', async () => {
    const id = '66666666-6666-4666-8666-666666666663';
    await asUser(USER);
    await push([projectMutation({ id, mutationId: '66666666-6666-4666-8666-6666666666a3' })]);

    await asSuperuser();
    const { rows } = await db.query<{ area_id: string | null }>(
      `select area_id from projects where id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.area_id).toBeNull();
  });

  it('stamps completed_at when a project turns done, which 0020 added', async () => {
    // The client cannot send completed_at: sync_server_owned_columns strips it
    // from every push, for every table. Before 0020 nothing else set it either,
    // so the column stayed null forever on a table that has carried it since
    // 0001.
    const response = await setStatus('done', '66666666-6666-4666-8666-6666666666a4');
    expect(response.results[0]).toMatchObject({ status: 'applied' });
    expect(await completedAt()).toBeInstanceOf(Date);
  });

  it('clears it again when the project reopens', async () => {
    await setStatus('active', '66666666-6666-4666-8666-6666666666a5');
    expect(await completedAt()).toBeNull();
  });

  it('leaves a cancelled project without a completion date', async () => {
    // Abandoned in March is not finished in March. A date here would put the
    // project in anything that counts completed work.
    await setStatus('cancelled', '66666666-6666-4666-8666-6666666666a6');
    expect(await completedAt()).toBeNull();
  });

  it('keeps one account out of another account\'s areas', async () => {
    await asUser(OTHER);
    const { rows } = await db.query(`select id from areas where id = '${AREA}'`);
    expect(rows).toEqual([]);
  });
});

describe('0020 on a database that already has done projects', () => {
  /**
   * The migration applied to a schema that predates it, which is the only state
   * it will ever actually run against.
   *
   * Its own PGlite instance, booted to 0019, because the shared one in this file
   * already has 0020 in it and a migration cannot be tested after the fact. The
   * first draft of 0020 put the backfill after `create trigger` and this case is
   * what caught it: the else arm sets `new.completed_at := old.completed_at`,
   * which for a row that has been done since before the trigger existed is null,
   * so the trigger reverted the backfill on the way through and the statement
   * reported "UPDATE n" having changed nothing.
   */
  const OLD = '77777777-7777-4777-8777-777777777771';
  const GONE = '77777777-7777-4777-8777-777777777772';
  let old: PGlite;

  beforeAll(async () => {
    const upTo0019 = MIGRATIONS.slice(0, MIGRATIONS.indexOf('0020_project_completed_at'));
    old = await bootPostgres(upTo0019);
    await createUsers(old, [USER]);
    await ownerRole(old);

    await old.query(
      `insert into public.projects (id, user_id, name, status, sort_key)
       values ($1, $2, 'Kitchen rewire', 'done', 'a0')`,
      [OLD, USER],
    );
    await old.query(
      `insert into public.projects (id, user_id, name, status, sort_key, deleted_at)
       values ($1, $2, 'Abandoned', 'done', 'a1', now())`,
      [GONE, USER],
    );
  }, 60_000);

  afterAll(async () => {
    await old?.close();
  });

  async function completedAtIn(id: string): Promise<Date | null> {
    const { rows } = await old.query<{ completed_at: Date | null }>(
      `select completed_at from projects where id = $1`,
      [id],
    );
    return rows[0]?.completed_at ?? null;
  }

  it('starts with the column empty, which is the bug', async () => {
    expect(await completedAtIn(OLD)).toBeNull();
  });

  it('fills it, and the fill survives the trigger the same migration creates', async () => {
    await old.exec(migrationSql('0020_project_completed_at'));
    expect(await completedAtIn(OLD)).toBeInstanceOf(Date);
  });

  it('leaves a tombstoned project alone', async () => {
    expect(await completedAtIn(GONE)).toBeNull();
  });

  it('derives it from then on', async () => {
    const id = '77777777-7777-4777-8777-777777777773';
    await old.query(
      `insert into public.projects (id, user_id, name, status, sort_key)
       values ($1, $2, 'Repaint', 'done', 'a2')`,
      [id, USER],
    );
    expect(await completedAtIn(id)).toBeInstanceOf(Date);
  });
});

describe('a name two live tags cannot both hold', () => {
  /**
   * 0021. `tags_user_name_live_idx` is unique over (user_id, lower(name)) among
   * rows with no tombstone, so both a rename and an undelete can collide. The
   * update arm caught check and foreign key violations and not this one, and the
   * delete/undelete arm caught nothing at all, so 23505 raised out of the whole
   * function. The client settles a raised error across every mutation it claimed
   * in the same batch, which sent unrelated edits to the deadletter.
   */
  const WORK = '55555555-5555-4555-8555-555555555551';
  const ADMIN = '55555555-5555-4555-8555-555555555552';
  const REPLACEMENT = '55555555-5555-4555-8555-555555555553';
  const BYSTANDER = '55555555-5555-4555-8555-555555555554';
  const READING = '55555555-5555-4555-8555-555555555561';
  /** Only this block's rows. The shared database carries tags other cases made. */
  const OWNED = [WORK, ADMIN, REPLACEMENT, BYSTANDER, READING];

  function tagInsert(id: string, name: string, mutationId: string) {
    return {
      mutationId,
      table: 'tags',
      entityId: id,
      op: 'insert',
      patch: { id, name, color: '#C29B72', sort_key: 'a0' },
      baseVersion: 0,
    };
  }

  async function liveNames() {
    await asSuperuser();
    const { rows } = await db.query<{ name: string }>(
      `select name from tags
        where user_id = '${USER}' and deleted_at is null
          and id in (${OWNED.map((id) => `'${id}'`).join(', ')})
        order by name`,
    );
    await asUser(USER);
    return rows.map((row) => row.name);
  }

  it('sets up two tags', async () => {
    await asUser(USER);
    const response = await push([
      tagInsert(WORK, 'work', '55555555-5555-4555-8555-55555555555a'),
      tagInsert(ADMIN, 'admin', '55555555-5555-4555-8555-55555555555b'),
    ]);
    expect(response.results.map((r) => (r as { status: string }).status)).toEqual([
      'applied',
      'applied',
    ]);
  });

  it('refuses a rename onto a taken name and commits the rest of the batch', async () => {
    await asUser(USER);
    const response = await push([
      {
        mutationId: '55555555-5555-4555-8555-55555555555c',
        table: 'tags',
        entityId: WORK,
        op: 'update',
        // Different case, same name. The index is over lower(name), which is
        // what ensureTag on the client assumes when it looks a name up.
        patch: { name: 'Admin' },
        baseVersion: 0,
      },
      tagInsert(BYSTANDER, 'errands', '55555555-5555-4555-8555-55555555555d'),
    ]);

    expect(response.results[0]).toMatchObject({ status: 'rejected' });
    // The whole point. This one had nothing to do with the collision.
    expect(response.results[1]).toMatchObject({ status: 'applied' });
    expect(await liveNames()).toEqual(['admin', 'errands', 'work']);
  });

  it('answers a retry from the log rather than raising again', async () => {
    await asUser(USER);
    const again = await push([
      {
        mutationId: '55555555-5555-4555-8555-55555555555c',
        table: 'tags',
        entityId: WORK,
        op: 'update',
        patch: { name: 'Admin' },
        baseVersion: 0,
      },
    ]);
    expect(again.results[0]).toMatchObject({ status: 'rejected' });
  });

  it('refuses an undelete onto a name that filled in behind it', async () => {
    await asUser(USER);
    // The sequence a person can walk: delete #work, type it again before the
    // toast expires, then press Undo.
    await push([
      {
        mutationId: '55555555-5555-4555-8555-55555555555e',
        table: 'tags',
        entityId: WORK,
        op: 'delete',
        patch: {},
        baseVersion: 0,
      },
      tagInsert(REPLACEMENT, 'work', '55555555-5555-4555-8555-55555555555f'),
    ]);
    expect(await liveNames()).toEqual(['admin', 'errands', 'work']);

    const undo = await push([
      {
        mutationId: '55555555-5555-4555-8555-555555555560',
        table: 'tags',
        entityId: WORK,
        op: 'undelete',
        patch: {},
        baseVersion: 0,
      },
      tagInsert(READING, 'reading', '55555555-5555-4555-8555-555555555562'),
    ]);

    expect(undo.results[0]).toMatchObject({ status: 'rejected' });
    expect(undo.results[1]).toMatchObject({ status: 'applied' });
    // The tombstone stays down. Two live rows named work is the state the index
    // exists to prevent.
    expect(await liveNames()).toEqual(['admin', 'errands', 'reading', 'work']);
  });

  it('still undeletes when the name is free', async () => {
    await asUser(USER);
    await push([
      {
        mutationId: '55555555-5555-4555-8555-555555555563',
        table: 'tags',
        entityId: REPLACEMENT,
        op: 'delete',
        patch: {},
        baseVersion: 0,
      },
    ]);
    const undo = await push([
      {
        mutationId: '55555555-5555-4555-8555-555555555564',
        table: 'tags',
        entityId: WORK,
        op: 'undelete',
        patch: {},
        baseVersion: 0,
      },
    ]);
    expect(undo.results[0]).toMatchObject({ status: 'applied' });
    expect(await liveNames()).toEqual(['admin', 'errands', 'reading', 'work']);
  });
});

describe('what 0021 actually fixes', () => {
  /**
   * The same two pushes against 0020, where a collision raised out of sync_push
   * and took the mutation behind it with it. Booted separately because the
   * shared database has the fix applied, and the whole claim is about what the
   * function did before it.
   */
  const TAG_A = '66666666-6666-4666-8666-666666666661';
  const TAG_B = '66666666-6666-4666-8666-666666666662';

  it('raises on a rename and on an undelete, and loses the batch', async () => {
    const old = await bootPostgres(MIGRATIONS.filter((name) => name !== '0021_push_unique_violation'));
    try {
      await createUsers(old, [USER]);
      await userRole(old, USER);

      const send = (mutations: unknown[]) =>
        old.query('select public.sync_push($1::jsonb) as sync_push', [JSON.stringify(mutations)]);

      await send([
        {
          mutationId: '66666666-6666-4666-8666-66666666666a',
          table: 'tags',
          entityId: TAG_A,
          op: 'insert',
          patch: { id: TAG_A, name: 'work', color: '#C29B72', sort_key: 'a0' },
          baseVersion: 0,
        },
        {
          mutationId: '66666666-6666-4666-8666-66666666666b',
          table: 'tags',
          entityId: TAG_B,
          op: 'insert',
          patch: { id: TAG_B, name: 'admin', color: '#C29B72', sort_key: 'a0' },
          baseVersion: 0,
        },
      ]);

      await expect(
        send([
          {
            mutationId: '66666666-6666-4666-8666-66666666666c',
            table: 'tags',
            entityId: TAG_A,
            op: 'update',
            patch: { name: 'admin' },
            baseVersion: 0,
          },
          {
            mutationId: '66666666-6666-4666-8666-66666666666d',
            table: 'tags',
            entityId: '66666666-6666-4666-8666-666666666663',
            op: 'insert',
            patch: {
              id: '66666666-6666-4666-8666-666666666663',
              name: 'innocent',
              color: '#C29B72',
              sort_key: 'a0',
            },
            baseVersion: 0,
          },
        ]),
      ).rejects.toThrow();

      // The mutation queued behind the collision never landed, which is what
      // the client then deadlettered along with it.
      await old.exec('reset role');
      const { rows } = await old.query("select id from tags where name = 'innocent'");
      expect(rows).toHaveLength(0);
    } finally {
      await old.close();
    }
  }, 60_000);
});
