import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localToWire } from './mapping';

/**
 * The sync RPCs, executed against a real Postgres.
 *
 * PGlite is Postgres compiled to wasm, so this runs the actual migrations, the
 * actual plpgsql and the actual constraints in-process, with no Docker and no
 * cloud project. That matters because the two worst bugs in this project so far
 * were both in SQL that every other test happily ignored: an insert that could
 * not run at all, and a per-field merge nobody had ever executed.
 *
 * Grep tests can tell you a policy is shaped correctly. Only this can tell you
 * the thing works.
 */

const MIGRATIONS = ['0001_core_schema', '0002_rls', '0003_sync_rpc', '0004_fix_push_insert'];

function migration(name: string): string {
  return (
    readFileSync(join(process.cwd(), 'supabase', 'migrations', `${name}.sql`), 'utf8')
      // PGlite ships without contrib extensions. Nothing in the schema calls
      // pgcrypto, since every id is generated on the client, so removing the
      // line leaves everything under test intact.
      .replace(/create extension[^;]+;/gi, '')
  );
}

/** The pieces Supabase provides that a bare Postgres does not. */
const SUPABASE_STUBS = `
  create role authenticated;
  create role anon;
  create role service_role;

  create schema auth;
  create table auth.users (id uuid primary key, email text);

  -- Matches Supabase's own implementation: the uid comes from the request's
  -- JWT claims, which is what makes every RLS policy in 0002 work.
  create or replace function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
  $$;
`;

/**
 * Supabase grants these through default privileges on the public schema. A bare
 * Postgres has no such default, and without them a SECURITY INVOKER function
 * fails with 42501 before RLS is ever consulted.
 */
const GRANTS = `
  -- Without usage on auth, every policy fails at auth.uid() before it ever
  -- evaluates a row.
  grant usage on schema auth to authenticated;
  grant select on auth.users to authenticated;
  grant usage on schema public to authenticated;
  grant all on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
`;

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

let db: PGlite;

async function asUser(uid: string) {
  await db.exec(`set request.jwt.claims = '{"sub":"${uid}"}'; set role authenticated;`);
}

async function asSuperuser() {
  await db.exec(`reset role; set request.jwt.claims = '';`);
}

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
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const name of MIGRATIONS) await db.exec(migration(name));
  await db.exec(GRANTS);
  await db.exec(
    `insert into auth.users (id, email) values
       ('${USER}', 'a@example.com'), ('${OTHER}', 'b@example.com');`,
  );
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
    const stale = Number(base.row_version) - 5;

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
    const old = new PGlite();
    try {
      await old.exec(SUPABASE_STUBS);
      for (const name of ['0001_core_schema', '0002_rls', '0003_sync_rpc']) {
        await old.exec(migration(name));
      }
      await old.exec(GRANTS);
      await old.exec(`insert into auth.users (id, email) values ('${USER}', 'a@example.com');`);
      await old.exec(`set request.jwt.claims = '{"sub":"${USER}"}'; set role authenticated;`);

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
