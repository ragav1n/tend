import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { setDb, TendDb } from './client';
import {
  createProject,
  createTag,
  createTask,
  deleteTask,
  ensureTag,
  reorderTask,
  restoreTask,
  setTaskTags,
  updateTask,
} from './mutations';
import {
  inboxList,
  projectList,
  searchTasks,
  somedayList,
  subtasksOf,
  taggedWith,
  today,
  todayList,
  upcomingList,
} from './queries';
import { NO_DUE_DAY } from './types';

let db: TendDb;
let dbName: string;
let counter = 0;

beforeEach(async () => {
  dbName = `tend_test_${Date.now()}_${counter++}`;
  db = new TendDb(dbName);
  setDb(db);
  await db.open();
});

afterEach(async () => {
  db.close();
  setDb(null);
  await Dexie.delete(dbName);
});

const TODAY = today();
function daysFrom(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('the single write API', () => {
  it('writes the local row and the outbox record together', async () => {
    const id = await createTask({ title: 'Buy oat milk' }, db);

    const row = await db.tasks.get(id);
    expect(row?.title).toBe('Buy oat milk');

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      table: 'tasks',
      entityId: id,
      op: 'insert',
      state: 'pending',
      baseVersion: 0,
    });
  });

  it('never puts server-owned columns in a patch', async () => {
    await createTask({ title: 'Renew passport' }, db);
    const [record] = await db.outbox.toArray();
    const patch = record!.patch;

    // Sending any of these would fight a Postgres trigger for ownership.
    for (const banned of [
      'updatedAt',
      'rowVersion',
      'completedAt',
      'depth',
      '_del',
      '_done',
      '_dueDay',
      '_plannedDay',
      '_tagIds',
      '_words',
    ]) {
      expect(patch, banned).not.toHaveProperty(banned);
    }
    expect(patch).toHaveProperty('title');
    expect(patch).toHaveProperty('sortKey');
  });

  it('queues a sparse patch on update, not the whole row', async () => {
    const id = await createTask({ title: 'Call the dentist' }, db);
    await db.outbox.clear();

    await updateTask(id, { priority: 2 }, db);
    const [record] = await db.outbox.toArray();
    expect(Object.keys(record!.patch)).toEqual(['priority']);
    expect(record!.op).toBe('update');
  });

  it('carries the rowVersion it edited against, so the server can merge per field', async () => {
    const id = await createTask({ title: 'File taxes' }, db);
    // Simulate a pull having landed a canonical row at version 7.
    await db.tasks.update(id, { rowVersion: 7 });
    await db.outbox.clear();

    await updateTask(id, { title: 'File taxes early' }, db);
    const [record] = await db.outbox.toArray();
    expect(record!.baseVersion).toBe(7);
  });
});

describe('completion', () => {
  it('sets completedAt optimistically and flips the derived _done flag', async () => {
    const id = await createTask({ title: 'Water the plants' }, db);
    await updateTask(id, { status: 'done' }, db);

    const row = await db.tasks.get(id);
    expect(row!._done).toBe(1);
    expect(row!.completedAt).toBeTruthy();
  });

  it('clears completedAt when a task is reopened', async () => {
    const id = await createTask({ title: 'Water the plants' }, db);
    await updateTask(id, { status: 'done' }, db);
    await updateTask(id, { status: 'active' }, db);

    const row = await db.tasks.get(id);
    expect(row!._done).toBe(0);
    expect(row!.completedAt).toBeNull();
  });

  it('treats cancelled as closed too, so it leaves the open lists', async () => {
    const id = await createTask({ title: 'Book the venue', dueDate: TODAY }, db);
    await updateTask(id, { status: 'cancelled' }, db);
    expect(await todayList(TODAY, db)).toHaveLength(0);
  });
});

describe('soft delete', () => {
  it('tombstones rather than removing, so restore is one more field write', async () => {
    const id = await createTask({ title: 'Cancel the gym' }, db);
    await deleteTask(id, db);

    const row = await db.tasks.get(id);
    expect(row).toBeDefined();
    expect(row!.deletedAt).toBeTruthy();
    expect(row!._del).toBe(1);
    expect(row!.title).toBe('Cancel the gym');

    await restoreTask(id, db);
    expect((await db.tasks.get(id))!._del).toBe(0);
  });

  it('cascades to subtasks, matching the Postgres composite FK', async () => {
    const parent = await createTask({ title: 'Move flat' }, db);
    const child = await createTask({ title: 'Pack kitchen', parentTaskId: parent }, db);

    await deleteTask(parent, db);
    expect((await db.tasks.get(child))!._del).toBe(1);
  });

  it('hides tombstones from every list', async () => {
    const id = await createTask({ title: 'Ghost task', dueDate: TODAY }, db);
    await deleteTask(id, db);

    expect(await todayList(TODAY, db)).toHaveLength(0);
    expect(await inboxList(db)).toHaveLength(0);
    expect(await searchTasks('ghost', 50, db)).toHaveLength(0);
  });
});

describe('hierarchy', () => {
  it('caps depth at 1 and keeps a subtask out of the top-level lists', async () => {
    const parent = await createTask({ title: 'Ship the feature' }, db);
    const child = await createTask({ title: 'Write the migration', parentTaskId: parent }, db);

    expect((await db.tasks.get(child))!.depth).toBe(1);
    expect((await db.tasks.get(parent))!.depth).toBe(0);

    const inbox = await inboxList(db);
    expect(inbox.map((t) => t.id)).toEqual([parent]);

    const kids = await subtasksOf(parent, db);
    expect(kids.map((t) => t.id)).toEqual([child]);
  });

  it('does not store a subtask project twice, since the parent owns it', async () => {
    const project = await createProject({ name: 'Home' }, db);
    const parent = await createTask({ title: 'Fix the sink', projectId: project }, db);
    const child = await createTask({ title: 'Buy a washer', parentTaskId: parent }, db);

    expect((await db.tasks.get(child))!.projectId).toBe('');
  });
});

describe('ordering', () => {
  it('appends new tasks to the end of the list', async () => {
    const a = await createTask({ title: 'First' }, db);
    const b = await createTask({ title: 'Second' }, db);
    const c = await createTask({ title: 'Third' }, db);

    const ids = (await inboxList(db)).map((t) => t.id);
    expect(ids).toEqual([a, b, c]);
  });

  it('reorders by touching exactly one row, which is what makes it merge-safe', async () => {
    const a = await createTask({ title: 'First' }, db);
    const b = await createTask({ title: 'Second' }, db);
    const c = await createTask({ title: 'Third' }, db);

    const before = await inboxList(db);
    const keysBefore = new Map(before.map((t) => [t.id, t.sortKey]));
    await db.outbox.clear();

    // Move c between a and b.
    await reorderTask(c, keysBefore.get(a)!, keysBefore.get(b)!, 'sortKey', db);

    expect((await inboxList(db)).map((t) => t.id)).toEqual([a, c, b]);

    const records = await db.outbox.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]!.entityId).toBe(c);
    expect(Object.keys(records[0]!.patch)).toEqual(['sortKey']);
  });

  it('gives every task a distinct rank', async () => {
    const ids = [];
    for (let i = 0; i < 25; i++) ids.push(await createTask({ title: `Task ${i}` }, db));
    const keys = (await inboxList(db)).map((t) => t.sortKey);
    expect(new Set(keys).size).toBe(ids.length);
  });
});

describe('tags', () => {
  it('creates the task and its join rows in one batch', async () => {
    const work = await createTag({ name: 'work' }, db);
    await db.outbox.clear();

    const id = await createTask({ title: 'Draft the deck', tagIds: [work] }, db);

    const records = await db.outbox.toArray();
    const batchIds = new Set(records.map((r) => r.batchId));
    expect(batchIds.size).toBe(1);
    expect([...batchIds][0]).not.toBeNull();

    // The join row depends on the task existing server-side first.
    const join = records.find((r) => r.table === 'taskTags');
    expect(join!.deps).toContain(id);
  });

  it('denormalizes tag ids onto the task so filtering is one index scan', async () => {
    const work = await createTag({ name: 'work' }, db);
    const id = await createTask({ title: 'Draft the deck', tagIds: [work] }, db);

    expect((await db.tasks.get(id))!._tagIds).toEqual([work]);
    expect((await taggedWith(work, db)).map((t) => t.id)).toEqual([id]);
  });

  it('replaces the whole tag set and keeps the denormalized copy in step', async () => {
    const work = await createTag({ name: 'work' }, db);
    const home = await createTag({ name: 'home' }, db);
    const id = await createTask({ title: 'Sort the shed', tagIds: [work] }, db);

    await setTaskTags(id, [home], db);

    expect((await db.tasks.get(id))!._tagIds).toEqual([home]);
    expect(await taggedWith(work, db)).toHaveLength(0);
    expect((await taggedWith(home, db)).map((t) => t.id)).toEqual([id]);
  });

  it('matches an existing tag by name regardless of case', async () => {
    const first = await createTag({ name: 'Work' }, db);
    expect(await ensureTag('work', db)).toBe(first);
    expect(await ensureTag('  WORK  ', db)).toBe(first);
    expect(await db.tags.count()).toBe(1);
  });
});

describe('views', () => {
  it('puts overdue tasks above today, each group in the user order', async () => {
    const overdue = await createTask({ title: 'Late', dueDate: daysFrom(-3) }, db);
    const dueToday = await createTask({ title: 'Now', dueDate: TODAY }, db);
    await createTask({ title: 'Later', dueDate: daysFrom(5) }, db);

    const ids = (await todayList(TODAY, db)).map((t) => t.id);
    expect(ids).toEqual([overdue, dueToday]);
  });

  it('includes a task planned for today even with no due date', async () => {
    const planned = await createTask({ title: 'Read the paper', plannedFor: TODAY }, db);
    const ids = (await todayList(TODAY, db)).map((t) => t.id);
    expect(ids).toEqual([planned]);
  });

  it('does not double-count a task that is both due and planned today', async () => {
    await createTask({ title: 'Overlap', dueDate: TODAY, plannedFor: TODAY }, db);
    expect(await todayList(TODAY, db)).toHaveLength(1);
  });

  it('excludes today from upcoming', async () => {
    await createTask({ title: 'Now', dueDate: TODAY }, db);
    const soon = await createTask({ title: 'Soon', dueDate: daysFrom(2) }, db);

    expect((await upcomingList(TODAY, 30, db)).map((t) => t.id)).toEqual([soon]);
  });

  it('parks dateless tasks in someday via the sentinel, not a separate query', async () => {
    const id = await createTask({ title: 'Learn to sail' }, db);
    expect((await db.tasks.get(id))!._dueDay).toBe(NO_DUE_DAY);
    expect((await somedayList(db)).map((t) => t.id)).toEqual([id]);
  });

  it('keeps a filed task out of the inbox', async () => {
    const project = await createProject({ name: 'Reading' }, db);
    const filed = await createTask({ title: 'Finish the novel', projectId: project }, db);
    const unfiled = await createTask({ title: 'Random thought' }, db);

    expect((await inboxList(db)).map((t) => t.id)).toEqual([unfiled]);
    expect((await projectList(project, db)).map((t) => t.id)).toEqual([filed]);
  });
});

describe('search', () => {
  it('matches on a prefix of any word in the title', async () => {
    const id = await createTask({ title: 'Renew the passport' }, db);
    expect((await searchTasks('pass', 50, db)).map((t) => t.id)).toEqual([id]);
    expect((await searchTasks('renew', 50, db)).map((t) => t.id)).toEqual([id]);
  });

  it('searches notes as well as titles', async () => {
    const id = await createTask({ title: 'Trip', notes: 'book the ferry to Rotterdam' }, db);
    expect((await searchTasks('ferry', 50, db)).map((t) => t.id)).toEqual([id]);
  });

  it('folds diacritics, so cafe finds Café', async () => {
    const id = await createTask({ title: 'Meet at the Café' }, db);
    expect((await searchTasks('cafe', 50, db)).map((t) => t.id)).toEqual([id]);
  });

  it('intersects terms, so a two-word query narrows instead of widening', async () => {
    const both = await createTask({ title: 'Buy milk' }, db);
    await createTask({ title: 'Buy bread' }, db);
    await createTask({ title: 'Milk the joke' }, db);

    expect((await searchTasks('buy milk', 50, db)).map((t) => t.id)).toEqual([both]);
  });

  it('ignores single characters, which would match nearly everything', async () => {
    await createTask({ title: 'A task' }, db);
    expect(await searchTasks('a', 50, db)).toHaveLength(0);
  });
});
