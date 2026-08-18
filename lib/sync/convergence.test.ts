import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TendDb } from '@/lib/db/client';
import {
  completeTask,
  createProject,
  createTag,
  createTask,
  deleteTask,
  setTaskRecurrence,
  setTaskTags,
  updatePrefs,
  updateTask,
} from '@/lib/db/mutations';
import { today } from '@/lib/db/queries';
import { DEFAULT_RULE } from '@/lib/db/series';
import { applyPage } from './apply';
import { BACKOFF_BASE_MS, classify } from './errors';
import { deadCount, pendingCount } from './outbox';
import type { PullResponse, PushResponse } from './protocol';
import { asSuperuser, asUser, bootPostgres, createUsers } from './testing/postgres';

/**
 * Two devices, one Postgres, and the question the whole data layer exists to
 * answer: do they end up holding the same thing.
 *
 * This is the test that justifies a hand-written sync engine, so it drives the
 * real pieces. Real `mutations.ts` writes into real Dexie on `fake-indexeddb`,
 * the real outbox claims and acks, the real `sync_push` and `sync_pull` run in
 * PGlite, and the real apply path writes the answers back. The only stand-in is
 * `fetch`, replaced by a function that hands the body to the same RPC the route
 * handler calls and turns a Postgres error into the same status the route would.
 *
 * The three scenarios the plan calls for are interleaved writes, a partition and
 * duplicate delivery. A fourth earned its place by failing: two devices ticking
 * off the same recurring task both generate occurrence 1, and before 0005 the
 * loser's whole batch went to the deadletter.
 */

const USER = '00000000-0000-4000-8000-0000000000aa';

/** Whose turn it is. Set for the length of one device's cycle. */
let deliver: ((path: string, body: unknown) => Promise<unknown>) | null = null;

vi.mock('./transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transport')>();
  return {
    ...actual,
    postJson: async (path: string, body: unknown) => {
      if (!deliver) throw new Error(`nothing is syncing, so ${path} has nowhere to go`);
      return deliver(path, body);
    },
  };
});

const { pushOnce } = await import('./push');
const { pullOnce } = await import('./pull');
const { SyncError } = await import('./transport');

let pg: PGlite;
let devices: Device[] = [];
let dbCount = 0;

interface Device {
  name: string;
  db: TendDb;
  /** False makes every request reject the way an unreachable network does. */
  online: boolean;
  /** True lets the request reach Postgres and throws the response away. */
  loseResponses: boolean;
}

async function device(name: string): Promise<Device> {
  dbCount += 1;
  const db = new TendDb(`tend_convergence_${name}_${dbCount}`);
  await db.open();
  const created = { name, db, online: true, loseResponses: false };
  devices.push(created);
  return created;
}

/**
 * A Postgres error as the client would receive it.
 *
 * Both route handlers map the SQLSTATE to a status and pass the code through,
 * and the transport classifies the pair. Mirrored here so a device under test
 * reacts to exactly what production would hand it.
 */
function asRouteFailure(error: unknown): Error {
  const raw = (error as { code?: unknown }).code;
  const code = typeof raw === 'string' ? raw : undefined;
  const status = code === '28000' ? 401 : code === '22023' ? 400 : 500;
  return new SyncError(
    classify({ status, code, message: error instanceof Error ? error.message : String(error) }),
  );
}

async function pushRpc(mutations: unknown): Promise<PushResponse> {
  try {
    const result = await pg.query<{ out: PushResponse }>(
      'select public.sync_push($1::jsonb) as out',
      [JSON.stringify(mutations)],
    );
    return result.rows[0]!.out;
  } catch (error) {
    throw asRouteFailure(error);
  }
}

async function pullRpc(cursor: number, limit = 500): Promise<PullResponse> {
  await asUser(pg, USER);
  try {
    const result = await pg.query<{ out: PullResponse }>(
      'select public.sync_pull($1, $2) as out',
      [cursor, limit],
    );
    return result.rows[0]!.out;
  } catch (error) {
    throw asRouteFailure(error);
  }
}

async function serve(target: Device, path: string, body: unknown): Promise<unknown> {
  if (!target.online) {
    // fetch rejects with a TypeError when the network is unreachable, which is
    // the failure this app sees most.
    throw new SyncError(classify(new TypeError('fetch failed')));
  }

  await asUser(pg, USER);
  const request = body as { mutations?: unknown; cursor?: number; limit?: number };
  const answer =
    path === '/api/sync/push'
      ? await pushRpc(request.mutations)
      : await pullRpc(Number(request.cursor ?? 0), request.limit);

  // The write committed and the answer never arrived, which is the case the
  // idempotency key exists for.
  if (target.loseResponses) throw new SyncError(classify(new TypeError('fetch failed')));

  return answer;
}

/**
 * One engine cycle: push until the queue is empty, then pull until caught up.
 *
 * Same order and same stopping rule as `machine.ts`, without the state machine,
 * because what is under test here is what the two stores end up holding.
 */
async function cycle(target: Device): Promise<void> {
  if (deliver) throw new Error('two devices cannot sync at once through one route');
  deliver = (path, body) => serve(target, path, body);

  try {
    for (let i = 0; i < 20; i += 1) if (!(await pushOnce(target.db)).hasMore) break;
    for (let i = 0; i < 20; i += 1) if (!(await pullOnce(target.db)).hasMore) break;
  } finally {
    deliver = null;
  }
}

/**
 * Runs something with the clock past the outbox backoff.
 *
 * A failed record carries `nextAttemptAt`, so a retry the same millisecond finds
 * nothing ready. Only Date is faked: `fake-indexeddb` and Dexie both need real
 * timers to settle their callbacks.
 */
async function afterBackoff<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + BACKOFF_BASE_MS * 4);
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Everything a device holds that the server also holds.
 *
 * `userId` is dropped because the server never sends it back: a row this device
 * created keeps the local placeholder, and the same row pulled onto the other
 * device has no user at all. Every other field, derived ones included, has to
 * match, which is what proves the optimistic path and the apply path agree.
 */
async function snapshot(db: TendDb) {
  const strip = (row: object) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'userId'));
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((x, y) => x.id.localeCompare(y.id)).map(strip);

  return {
    prefs: (await db.prefs.toArray()).map(strip),
    tasks: byId(await db.tasks.toArray()),
    projects: byId(await db.projects.toArray()),
    tags: byId(await db.tags.toArray()),
    series: byId(await db.taskSeries.toArray()),
    taskTags: [...(await db.taskTags.toArray())]
      .sort((x, y) => `${x.taskId}${x.tagId}`.localeCompare(`${y.taskId}${y.tagId}`))
      .map(strip),
  };
}

/** Live task rows straight from Postgres, RLS out of the way. */
async function serverTasks(): Promise<{ id: string; title: string }[]> {
  await asSuperuser(pg);
  const { rows } = await pg.query<{ id: string; title: string }>(
    'select id, title from public.tasks where deleted_at is null order by id',
  );
  return rows;
}

/** The whole point: same rows on both devices, same rows on the server, queues empty. */
async function expectConverged(a: Device, b: Device): Promise<void> {
  expect(await snapshot(a.db)).toEqual(await snapshot(b.db));

  const server = await serverTasks();
  for (const target of [a, b]) {
    const live = (await target.db.tasks.where('_del').equals(0).toArray())
      .sort((x, y) => x.id.localeCompare(y.id))
      .map((task) => ({ id: task.id, title: task.title }));
    expect(live, `${target.name} against Postgres`).toEqual(server);
    expect(await pendingCount(target.db), `${target.name} queue`).toBe(0);
    expect(await deadCount(target.db), `${target.name} deadletter`).toBe(0);
  }
}

beforeEach(async () => {
  pg = await bootPostgres();
  await createUsers(pg, [USER]);
}, 60_000);

afterEach(async () => {
  deliver = null;
  for (const target of devices) await target.db.delete();
  devices = [];
  await pg?.close();
});

describe('interleaved writes', () => {
  it('keeps both edits when two devices change one task at once', async () => {
    const a = await device('a');
    const b = await device('b');

    const taskId = await createTask({ title: 'Water the plants', dueDate: '2026-08-20' }, a.db);
    await cycle(a);
    await cycle(b);
    expect((await b.db.tasks.get(taskId))?.title).toBe('Water the plants');

    // Both from the version they last saw, each touching a different field.
    await updateTask(taskId, { title: 'Water the plants and the herbs' }, b.db);
    await updateTask(taskId, { notes: 'kitchen and hall' }, a.db);

    await cycle(a);
    await cycle(b);
    await cycle(a);

    const task = await a.db.tasks.get(taskId);
    expect(task?.title).toBe('Water the plants and the herbs');
    expect(task?.notes).toBe('kitchen and hall');
    await expectConverged(a, b);
  });

  it('keeps the later write and records the loss when both change one field', async () => {
    const a = await device('a');
    const b = await device('b');

    const taskId = await createTask({ title: 'Call the landlord' }, a.db);
    await cycle(a);
    await cycle(b);

    await updateTask(taskId, { title: 'Call the landlord about the boiler' }, a.db);
    await updateTask(taskId, { title: 'Email the landlord' }, b.db);

    await cycle(a);
    await cycle(b);
    await cycle(a);

    // First writer wins the field. The loser hears about it rather than being
    // told the write succeeded.
    expect((await b.db.tasks.get(taskId))?.title).toBe('Call the landlord about the boiler');
    const [conflict] = await b.db.conflicts.toArray();
    expect(conflict).toMatchObject({ table: 'tasks', entityId: taskId, droppedFields: ['title'] });
    await expectConverged(a, b);
  });

  it('converges when each device works on a different table', async () => {
    const a = await device('a');
    const b = await device('b');

    const taskId = await createTask({ title: 'Prune the fig' }, a.db);
    await cycle(a);
    await cycle(b);

    // A files it into a new project. B tags it. Neither has seen the other.
    const projectId = await createProject({ name: 'Garden' }, a.db);
    await updateTask(taskId, { projectId }, a.db);

    const tagId = await createTag({ name: 'outdoors' }, b.db);
    await setTaskTags(taskId, [tagId], b.db);

    await cycle(a);
    await cycle(b);
    await cycle(a);

    const task = await a.db.tasks.get(taskId);
    expect(task?.projectId).toBe(projectId);
    // The tag arrived through the task, which is the only channel it has: the
    // join table rides on tasks.tag_ids and a trigger bumps the task's version.
    expect(task?._tagIds).toEqual([tagId]);
    expect((await b.db.projects.get(projectId))?.name).toBe('Garden');
    await expectConverged(a, b);
  });
});

describe('settings', () => {
  it('carry a change from one device to the other', async () => {
    const a = await device('a');
    const b = await device('b');

    await cycle(a);
    await cycle(b);
    // Created by the signup trigger, so both devices hold it before anybody
    // changes anything.
    expect((await b.db.prefs.get('me'))?.timezone).toBe('UTC');

    await updatePrefs({ timezone: 'America/New_York', digestTime: '06:30' }, a.db);
    await cycle(a);
    await cycle(b);

    const prefs = await b.db.prefs.get('me');
    expect(prefs?.timezone).toBe('America/New_York');
    // Postgres returns a time column as HH:MM:SS, so both devices settle on the
    // server's spelling rather than the one that was typed.
    expect(prefs?.digestTime).toBe('06:30:00');
    await expectConverged(a, b);
  });
});

describe('a delete racing an edit', () => {
  it('tombstones on both devices and keeps the edit on the row', async () => {
    const a = await device('a');
    const b = await device('b');

    const taskId = await createTask({ title: 'Cancel the gym' }, a.db);
    await cycle(a);
    await cycle(b);

    // A throws it away while B is still editing it. A tombstone is an ordinary
    // field write, so this needs no special case anywhere.
    await deleteTask(taskId, a.db);
    await updateTask(taskId, { notes: 'phone, not email' }, b.db);

    await cycle(a);
    await cycle(b);
    await cycle(a);

    for (const target of [a, b]) {
      const task = await target.db.tasks.get(taskId);
      expect(task?._del, target.name).toBe(1);
      expect(task?.notes, target.name).toBe('phone, not email');
    }
    await expectConverged(a, b);
  });
});

describe('a partition', () => {
  it('loses nothing while a device is cut off, and drains when it is back', async () => {
    const a = await device('a');
    const b = await device('b');

    const shared = await createTask({ title: 'Book the dentist' }, a.db);
    await cycle(a);
    await cycle(b);

    b.online = false;
    const offline = await createTask({ title: 'Renew the passport' }, b.db);
    await updateTask(shared, { priority: 2 }, b.db);

    await expect(cycle(b)).rejects.toThrow(/fetch failed/);

    // An unreachable server is the normal case for this app, so the work waits
    // rather than being retired.
    expect(await deadCount(b.db)).toBe(0);
    expect(await pendingCount(b.db)).toBe(2);

    // A keeps working and cannot see what B has not sent.
    await updateTask(shared, { notes: 'ask for a 3pm slot' }, a.db);
    await cycle(a);
    expect(await a.db.tasks.get(offline)).toBeUndefined();

    b.online = true;
    await afterBackoff(() => cycle(b));
    await cycle(a);

    const onA = await a.db.tasks.get(offline);
    expect(onA?.title).toBe('Renew the passport');
    expect((await a.db.tasks.get(shared))?.priority).toBe(2);
    expect((await b.db.tasks.get(shared))?.notes).toBe('ask for a 3pm slot');
    await expectConverged(a, b);
  });
});

describe('duplicate delivery', () => {
  it('applies a replayed push once', async () => {
    const a = await device('a');
    const b = await device('b');

    const taskId = await createTask({ title: 'Pay the water bill' }, a.db);

    a.loseResponses = true;
    await expect(cycle(a)).rejects.toThrow(/fetch failed/);
    a.loseResponses = false;

    // The row is in Postgres and the device still has the mutation queued, which
    // is the exact state a dropped ack leaves behind.
    expect(await serverTasks()).toHaveLength(1);
    expect(await pendingCount(a.db)).toBe(1);

    await afterBackoff(() => cycle(a));

    expect(await serverTasks()).toHaveLength(1);
    await asSuperuser(pg);
    const { rows } = await pg.query<{ n: number; version: number }>(
      'select count(*)::int as n, max(row_version)::int as version from public.tasks',
    );
    // One insert, one version. A second apply would have bumped it.
    expect(rows[0]!.n).toBe(1);
    expect((await a.db.tasks.get(taskId))?.rowVersion).toBe(rows[0]!.version);

    await cycle(b);
    await expectConverged(a, b);
  });

  it('applies the same pull page twice with no duplicates', async () => {
    const a = await device('a');
    const b = await device('b');

    const taskId = await createTask({ title: 'Sharpen the shears' }, a.db);
    const tagId = await createTag({ name: 'tools' }, a.db);
    await setTaskTags(taskId, [tagId], a.db);
    await cycle(a);

    const page = await pullRpc(0);
    const first = await applyPage(b.db, page.rows);
    const once = await snapshot(b.db);

    const again = await applyPage(b.db, page.rows);

    expect(first.applied).toBeGreaterThan(0);
    // Every row is already stored at that version, so the second pass writes
    // nothing. The tag set is the part that could have doubled: it is replaced
    // rather than merged.
    expect(again.applied).toBe(0);
    expect(again.skipped).toBe(first.applied);
    expect(await b.db.taskTags.toArray()).toHaveLength(1);
    expect(await snapshot(b.db)).toEqual(once);
  });
});

describe('two devices completing the same recurring task', () => {
  it('lets one occurrence win and gives the loser the winner', async () => {
    const a = await device('a');
    const b = await device('b');

    const taskId = await createTask({ title: 'Water the plants', dueDate: today() }, a.db);
    await setTaskRecurrence(
      taskId,
      { ...DEFAULT_RULE, interval: 3, anchorMode: 'completion_date' },
      a.db,
    );
    await cycle(a);
    await cycle(b);

    // Both tick it off before either syncs. occurrenceSeq advances by exactly
    // one on each device, so both generate occurrence 1 with different ids.
    const fromA = await completeTask(taskId, true, a.db);
    const fromB = await completeTask(taskId, true, b.db);
    expect(fromA).toBeTruthy();
    expect(fromB).toBeTruthy();
    expect(fromA).not.toBe(fromB);

    await cycle(a);
    await cycle(b);

    // B's insert lost the unique index, so B drops its row and takes A's rather
    // than showing the same occurrence twice.
    expect(await b.db.tasks.get(fromB!)).toBeUndefined();
    expect((await b.db.tasks.get(fromA!))?.title).toBe('Water the plants');

    // The batch carried two other mutations. Before 0005 the unique violation
    // rolled all of them back and the client retired every one to the
    // deadletter.
    expect(await deadCount(b.db)).toBe(0);
    expect(await pendingCount(b.db)).toBe(0);

    await cycle(a);
    await expectConverged(a, b);

    await asSuperuser(pg);
    const { rows } = await pg.query<{ n: number }>(
      `select count(*)::int as n from public.tasks
        where series_id is not null and occurrence_seq = 1 and deleted_at is null`,
    );
    expect(rows[0]!.n).toBe(1);
    // One completion, not two: the second device's count update lost the merge.
    const series = await b.db.taskSeries.toArray();
    expect(series[0]!.completedCount).toBe(1);
  });
});
