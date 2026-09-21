import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPostgres, createUsers, MIGRATIONS } from './testing/postgres';

/**
 * `cancelled_at`, against a real Postgres.
 *
 * The column exists because `cancelled` was a status nothing could reach: the
 * trigger stamped `completed_at` for `done` alone, so a cancelled task had
 * `_done = 1` and no timestamp, and IndexedDB does not index null. It left every
 * open list and arrived in none.
 *
 * What these hold is the trigger, the ordering rule the migration depends on,
 * and the separation from `completed_at` that keeps a cancellation out of the
 * streak.
 */

let pg: PGlite;
const USER = '00000000-0000-4000-8000-00000000c001';

async function one<T>(query: string, params: unknown[] = []): Promise<T> {
  const result = await pg.query<T>(query, params);
  return result.rows[0]!;
}

/** Ids are minted by the client, so the column has no default to lean on. */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `22222222-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

async function newTask(status = 'active'): Promise<string> {
  const id = nextId();
  await pg.query(
    `insert into public.tasks (id, user_id, title, status, sort_key)
     values ($1, $2, $3, $4, 'a0')`,
    [id, USER, `task ${seq}`, status],
  );
  return id;
}

const stamps = (id: string) =>
  one<{ completed_at: Date | null; cancelled_at: Date | null; status: string }>(
    'select status, completed_at, cancelled_at from public.tasks where id = $1',
    [id],
  );

beforeAll(async () => {
  pg = await bootPostgres();
  await createUsers(pg, [USER]);
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe('cancelling a task', () => {
  it('stamps cancelled_at and leaves completed_at alone', async () => {
    const id = await newTask();
    await pg.query(`update public.tasks set status = 'cancelled' where id = $1`, [id]);

    const row = await stamps(id);
    expect(row.cancelled_at).not.toBeNull();
    // The whole reason for a second column: a cancellation must not read as
    // finished work to the review or the streak.
    expect(row.completed_at).toBeNull();
  });

  it('stamps it on an insert that arrives already cancelled', async () => {
    const id = await newTask('cancelled');
    expect((await stamps(id)).cancelled_at).not.toBeNull();
  });

  it('clears it when the task is reopened', async () => {
    const id = await newTask();
    await pg.query(`update public.tasks set status = 'cancelled' where id = $1`, [id]);
    await pg.query(`update public.tasks set status = 'active' where id = $1`, [id]);

    expect((await stamps(id)).cancelled_at).toBeNull();
  });

  it('holds the first timestamp through an edit that leaves the status alone', async () => {
    const id = await newTask();
    await pg.query(`update public.tasks set status = 'cancelled' where id = $1`, [id]);
    const first = (await stamps(id)).cancelled_at;

    await pg.query(`update public.tasks set title = 'renamed' where id = $1`, [id]);
    expect((await stamps(id)).cancelled_at).toEqual(first);
  });

  it('clears cancelled_at when the task is completed instead', async () => {
    const id = await newTask();
    await pg.query(`update public.tasks set status = 'cancelled' where id = $1`, [id]);
    await pg.query(`update public.tasks set status = 'done' where id = $1`, [id]);

    const row = await stamps(id);
    expect(row.cancelled_at).toBeNull();
    expect(row.completed_at).not.toBeNull();
  });

  it('names cancelled_at as server owned, so a client cannot date one', async () => {
    const row = await one<{ cols: string[] }>('select public.sync_server_owned_columns() as cols');
    expect(row.cols).toContain('cancelled_at');
    expect(row.cols).toContain('completed_at');
  });
});

describe('the backfill', () => {
  it('reaches a row that was cancelled before the column existed', async () => {
    // Stand the schema up as it looked at 0021, cancel something, then apply
    // 0022 and check the row did not stay invisible. This is the ordering the
    // migration comment is about: run the backfill after the new trigger and
    // the else branch copies the old null straight back over it.
    const before = MIGRATIONS.slice(0, MIGRATIONS.indexOf('0022_task_cancelled_at'));
    const old = await bootPostgres(before);
    await createUsers(old, [USER]);

    const id = nextId();
    await old.query(
      `insert into public.tasks (id, user_id, title, status, sort_key)
       values ($1, $2, 'abandoned', 'cancelled', 'a0')`,
      [id, USER],
    );

    const { migrationSql } = await import('./testing/postgres');
    await old.exec(migrationSql('0022_task_cancelled_at'));

    const after = await old.query<{ cancelled_at: Date | null }>(
      'select cancelled_at from public.tasks where id = $1',
      [id],
    );
    expect(after.rows[0]!.cancelled_at).not.toBeNull();

    await old.close();
  }, 60_000);
});
