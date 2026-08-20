import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { setDb, TendDb } from './client';
import {
  clearTaskRecurrence,
  completeTask,
  startFocusSession,
  updateFocusSession,
  createProject,
  createTag,
  createTask,
  deleteTask,
  ensureTag,
  reorderTask,
  restoreTask,
  setTaskRecurrence,
  setTaskTags,
  updateTask,
} from './mutations';
import {
  addDays,
  dueBetween,
  focusBetween,
  focusSeconds,
  inboxList,
  unfinishedFocus,
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
/**
 * N days from today, in the device zone.
 *
 * Built from `addDays(today())` rather than from `toISOString()` on a local
 * Date: the second reads the UTC calendar day off a local instant, so anywhere
 * west of Greenwich the whole file starts failing in the evening. Found at
 * 20:08 EDT, which is 00:08 UTC.
 */
function daysFrom(n: number): string {
  return addDays(TODAY, n);
}

describe('the single write API', () => {
  it('writes the local row and the outbox record together', async () => {
    const id = await createTask({ title: 'Buy oat milk' }, db);

    const row = await db.tasks.get(id);
    expect(row?.title).toBe('Buy oat milk');

    // The activity entry rides in the same transaction, so the outbox holds
    // two records. Only the task one is what this test is about.
    const outbox = (await db.outbox.toArray()).filter((r) => r.table === 'tasks');
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
    // The activity entry is deliberately outside the batch: it carries no
    // foreign key, so nothing about it has to land in the same transaction.
    const batchIds = new Set(
      records.filter((r) => r.table !== 'activityLog').map((r) => r.batchId),
    );
    expect(batchIds.size).toBe(1);
    expect([...batchIds][0]).not.toBeNull();
    expect(records.find((r) => r.table === 'activityLog')?.batchId).toBeNull();

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

  it('gives the calendar the window it asked for, done work included', async () => {
    const inside = await createTask({ title: 'Inside', dueDate: daysFrom(2) }, db);
    const finished = await createTask({ title: 'Finished', dueDate: daysFrom(1) }, db);
    await completeTask(finished, true, db);
    await createTask({ title: 'Outside', dueDate: daysFrom(40) }, db);
    await createTask({ title: 'Dateless' }, db);
    await createTask({ title: 'Subtask', dueDate: daysFrom(2), parentTaskId: inside }, db);

    const rows = await dueBetween(daysFrom(0), daysFrom(30), db);
    // Ordered by day, and the completed one is still on the day it was due.
    expect(rows.map((t) => t.id)).toEqual([finished, inside]);
    expect(rows[0]!._done).toBe(1);
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

describe('recurrence', () => {
  /** Every day, counted from the due date. The rule most tasks get. */
  const DAILY = {
    freq: 'daily' as const,
    interval: 1,
    anchorMode: 'due_date' as const,
    catchupPolicy: 'skip_to_future' as const,
    endsMode: 'never' as const,
  };

  it('creates a series and points the task at it', async () => {
    const id = await createTask({ title: 'Water the plants', dueDate: TODAY }, db);
    const seriesId = await setTaskRecurrence(id, DAILY, db);

    const series = await db.taskSeries.get(seriesId!);
    expect(series).toMatchObject({ freq: 'daily', interval: 1, completedCount: 0, _del: 0 });

    const task = await db.tasks.get(id);
    expect(task?.seriesId).toBe(seriesId);
    // The anchor the first generation steps from.
    expect(task?.occurrenceDate).toBe(TODAY);
    expect(task?.occurrenceSeq).toBe(0);
  });

  it('falls back to today as the anchor when the task has no due date', async () => {
    const id = await createTask({ title: 'Stretch' }, db);
    await setTaskRecurrence(id, DAILY, db);
    expect((await db.tasks.get(id))?.occurrenceDate).toBe(TODAY);
  });

  it('edits the existing series rather than making a second one', async () => {
    const id = await createTask({ title: 'Standup', dueDate: TODAY }, db);
    const first = await setTaskRecurrence(id, DAILY, db);
    const second = await setTaskRecurrence(id, { ...DAILY, interval: 3 }, db);

    expect(second).toBe(first);
    expect(await db.taskSeries.count()).toBe(1);
    expect((await db.taskSeries.get(first!))?.interval).toBe(3);
  });

  it('queues the series insert without any server-owned column', async () => {
    const id = await createTask({ title: 'Bins', dueDate: TODAY }, db);
    const seriesId = await setTaskRecurrence(id, DAILY, db);

    const record = (await db.outbox.toArray()).find(
      (r) => r.table === 'taskSeries' && r.entityId === seriesId,
    );
    expect(record).toMatchObject({ op: 'insert', baseVersion: 0 });
    for (const column of ['updatedAt', 'rowVersion', '_del']) {
      expect(record?.patch).not.toHaveProperty(column);
    }
  });

  it('materializes the next occurrence when one is completed', async () => {
    const id = await createTask(
      { title: 'Water the plants', dueDate: TODAY, status: 'active' },
      db,
    );
    await setTaskRecurrence(id, DAILY, db);

    const nextId = await completeTask(id, true, db);
    expect(nextId).not.toBeNull();

    const next = await db.tasks.get(nextId!);
    expect(next).toMatchObject({
      title: 'Water the plants',
      dueDate: daysFrom(1),
      occurrenceDate: daysFrom(1),
      // Exactly +1. A seq derived from the skip count would differ between two
      // devices in different zones and defeat the server's uniqueness check.
      occurrenceSeq: 1,
      status: 'active',
      _done: 0,
    });

    // The completed one stays completed rather than being replaced.
    expect((await db.tasks.get(id))?._done).toBe(1);
    // And the series counted the completion.
    expect((await db.taskSeries.get(next!.seriesId))?.completedCount).toBe(1);
  });

  it('carries the tags forward and drops the day plan', async () => {
    const tagId = await ensureTag('garden', db);
    const id = await createTask(
      { title: 'Water the plants', dueDate: TODAY, plannedFor: TODAY, tagIds: [tagId] },
      db,
    );
    await setTaskRecurrence(id, DAILY, db);

    const nextId = await completeTask(id, true, db);
    const next = await db.tasks.get(nextId!);

    expect(next?._tagIds).toEqual([tagId]);
    expect(await db.taskTags.where('taskId').equals(nextId!).count()).toBe(1);
    // Today's plan is a decision about today, so it does not travel.
    expect(next?.plannedFor).toBeNull();
  });

  it('keeps a start date the same distance ahead of the due date', async () => {
    const id = await createTask(
      { title: 'File taxes', dueDate: daysFrom(10), startDate: daysFrom(7) },
      db,
    );
    await setTaskRecurrence(id, DAILY, db);

    const nextId = await completeTask(id, true, db);
    const next = await db.tasks.get(nextId!);
    expect(next?.dueDate).toBe(daysFrom(11));
    expect(next?.startDate).toBe(daysFrom(8));
  });

  it('counts from the completion date when the rule says so', async () => {
    const id = await createTask({ title: 'Change filter', dueDate: daysFrom(-9) }, db);
    await setTaskRecurrence(
      id,
      { ...DAILY, interval: 3, anchorMode: 'completion_date' },
      db,
    );

    const nextId = await completeTask(id, true, db);
    // Three days after finishing it, not three days after it was due.
    expect((await db.tasks.get(nextId!))?.dueDate).toBe(daysFrom(3));
  });

  it('stops after the agreed number of completions', async () => {
    const id = await createTask({ title: 'Take the course', dueDate: TODAY }, db);
    await setTaskRecurrence(id, { ...DAILY, endsMode: 'after_count', endsAfterCount: 2 }, db);

    const second = await completeTask(id, true, db);
    expect(second).not.toBeNull();

    const third = await completeTask(second!, true, db);
    expect(third).toBeNull();
    // The count still records the second completion, so nothing regenerates.
    const series = await db.taskSeries.get((await db.tasks.get(id))!.seriesId);
    expect(series?.completedCount).toBe(2);
  });

  it('generates nothing for a task that does not repeat', async () => {
    const id = await createTask({ title: 'One off', dueDate: TODAY }, db);
    expect(await completeTask(id, true, db)).toBeNull();
    expect(await db.tasks.count()).toBe(1);
  });

  it('generates nothing when a task is reopened', async () => {
    const id = await createTask({ title: 'Water the plants', dueDate: TODAY }, db);
    await setTaskRecurrence(id, DAILY, db);
    await completeTask(id, false, db);
    expect(await db.tasks.count()).toBe(1);
  });

  it('stops repeating without orphaning the completed occurrences', async () => {
    const id = await createTask({ title: 'Water the plants', dueDate: TODAY }, db);
    const seriesId = await setTaskRecurrence(id, DAILY, db);
    await clearTaskRecurrence(id, db);

    const task = await db.tasks.get(id);
    expect(task?.seriesId).toBe('');
    expect(task?.occurrenceDate).toBeNull();

    // Tombstoned rather than removed, so history still resolves.
    const series = await db.taskSeries.get(seriesId!);
    expect(series?._del).toBe(1);
    expect(series?.deletedAt).not.toBeNull();

    expect(await completeTask(id, true, db)).toBeNull();
  });

  it('does not regenerate from a series that was turned off', async () => {
    const id = await createTask({ title: 'Water the plants', dueDate: TODAY }, db);
    const seriesId = await setTaskRecurrence(id, DAILY, db);
    // Tombstone the series while the task still points at it, which is what a
    // delete arriving from another device looks like.
    await clearTaskRecurrence(id, db);
    await updateTask(id, { seriesId: seriesId! }, db);

    expect(await completeTask(id, true, db)).toBeNull();
  });
});

describe('undo of a delete', () => {
  it('brings back the subtasks the delete took with it', async () => {
    const parent = await createTask({ title: 'Ship the release' }, db);
    const child = await createTask({ title: 'Write notes', parentTaskId: parent }, db);

    await deleteTask(parent, db);
    expect((await db.tasks.get(child))?._del).toBe(1);

    await restoreTask(parent, db);
    expect((await db.tasks.get(parent))?._del).toBe(0);
    expect((await db.tasks.get(child))?._del).toBe(0);
    expect(await subtasksOf(parent, db)).toHaveLength(1);
  });

  it('leaves a subtask deleted on its own alone', async () => {
    const parent = await createTask({ title: 'Ship the release' }, db);
    const earlier = await createTask({ title: 'Old step', parentTaskId: parent }, db);
    const withParent = await createTask({ title: 'New step', parentTaskId: parent }, db);

    await deleteTask(earlier, db);
    // The two deletes have to land on different milliseconds, because
    // deletedAt is exactly what tells restore which rows belonged to which
    // delete. Back to back awaits can share a timestamp.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await deleteTask(parent, db);
    await restoreTask(parent, db);

    // Undo means undo that delete, not resurrect everything ever removed.
    expect((await db.tasks.get(earlier))?._del).toBe(1);
    expect((await db.tasks.get(withParent))?._del).toBe(0);
  });

  it('queues an undelete for every row it restores', async () => {
    const parent = await createTask({ title: 'Ship the release' }, db);
    await createTask({ title: 'Write notes', parentTaskId: parent }, db);
    await deleteTask(parent, db);
    await restoreTask(parent, db);

    const undeletes = (await db.outbox.toArray()).filter((r) => r.op === 'undelete');
    expect(undeletes).toHaveLength(2);
  });
});

describe('focus sessions', () => {
  it('writes the row when the timer starts, not when it ends', async () => {
    const taskId = await createTask({ title: 'Write the deck' }, db);
    const id = await startFocusSession(
      { taskId, plannedMinutes: 25, startedAt: '2026-08-19T14:00:00.000Z' },
      db,
    );

    const row = await db.focusSessions.get(id);
    expect(row).toMatchObject({
      taskId,
      plannedMinutes: 25,
      focusedSeconds: 0,
      endedAt: null,
      _del: 0,
    });

    const queued = await db.outbox.where('[table+entityId]').equals(['focusSessions', id]).toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.op).toBe('insert');
    // Derived fields are local, so they never reach the server.
    expect(queued[0]!.patch).not.toHaveProperty('_del');
  });

  it('banks what a pause measured without ending the session', async () => {
    const id = await startFocusSession(
      { plannedMinutes: 25, startedAt: '2026-08-19T14:00:00.000Z' },
      db,
    );
    await updateFocusSession(id, { focusedSeconds: 300 }, db);

    const row = await db.focusSessions.get(id);
    expect(row!.focusedSeconds).toBe(300);
    expect(row!.endedAt).toBeNull();
    expect((await unfinishedFocus('2026-08-19T00:00:00.000Z', db)).map((s) => s.id)).toEqual([id]);
  });

  it('closes it on the write that carries an end', async () => {
    const id = await startFocusSession(
      { plannedMinutes: 25, startedAt: '2026-08-19T14:00:00.000Z' },
      db,
    );
    await updateFocusSession(
      id,
      { focusedSeconds: 1500, endedAt: '2026-08-19T14:25:00.000Z' },
      db,
    );

    expect(await unfinishedFocus('2026-08-19T00:00:00.000Z', db)).toEqual([]);
    const window = await focusBetween('2026-08-19T00:00:00.000Z', '2026-08-19T23:59:59.999Z', db);
    expect(focusSeconds(window)).toBe(1500);
  });

  it('leaves a session outside the window out of the total', async () => {
    await startFocusSession({ plannedMinutes: 25, startedAt: '2026-08-18T09:00:00.000Z' }, db);
    const today = await startFocusSession(
      { plannedMinutes: 25, startedAt: '2026-08-19T09:00:00.000Z' },
      db,
    );

    const window = await focusBetween('2026-08-19T00:00:00.000Z', '2026-08-19T23:59:59.999Z', db);
    expect(window.map((s) => s.id)).toEqual([today]);
  });

  it('keeps a session with no task, since most have none', async () => {
    const id = await startFocusSession({ plannedMinutes: 50 }, db);
    expect((await db.focusSessions.get(id))!.taskId).toBe('');
  });
});
