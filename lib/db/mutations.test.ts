import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { setDb, TendDb } from './client';
import {
  cancelTasks,
  clearTaskRecurrence,
  completeTask,
  createArea,
  deleteArea,
  deleteProject,
  reorderArea,
  reorderProject,
  restoreArea,
  restoreProject,
  setProjectArchived,
  updateArea,
  updateProject,
  startFocusSession,
  updateFocusSession,
  createProject,
  createTag,
  createTask,
  deleteTag,
  deleteTask,
  ensureTag,
  renameTag,
  restoreTag,
  reorderTask,
  restoreTask,
  setTaskRecurrence,
  uncancelTasks,
  setTaskTags,
  updateTask,
} from './mutations';
import {
  addDays,
  allProjects,
  areaOptions,
  dueBetween,
  focusBetween,
  focusSeconds,
  cancelledList,
  logbook,
  taskById,
  inboxDeferred,
  inboxList,
  unfinishedFocus,
  projectList,
  searchTasks,
  somedayDeferred,
  somedayList,
  subtasksOf,
  taggedWith,
  tagCounts,
  tagOptions,
  subtasksForParents,
  projectCounts,
  projectDone,
  projectOptions,
  taskHistory,
  today,
  todayDeferred,
  todayList,
  upcomingList,
  VIEW_CANDIDATE_LIMIT,
  viewCandidates,
} from './queries';
import { undoLast } from './undo';
import { NO_DUE_DAY, NO_PROJECT } from './types';

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

  it('renames a tag and queues one update', async () => {
    const work = await createTag({ name: 'work' }, db);
    await db.outbox.clear();

    expect(await renameTag(work, '  errands  ', db)).toBe('ok');

    expect((await db.tags.get(work))!.name).toBe('errands');
    const records = await db.outbox.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]!.op).toBe('update');
    expect(records[0]!.patch).toEqual({ name: 'errands' });
  });

  it('refuses a rename onto a name another live tag holds', async () => {
    // Postgres has a case-insensitive unique index over live names, so the
    // alternative is a push that fails hours later and a rename that undoes
    // itself.
    const work = await createTag({ name: 'work' }, db);
    await createTag({ name: 'Home' }, db);

    expect(await renameTag(work, 'home', db)).toBe('taken');
    expect((await db.tags.get(work))!.name).toBe('work');
  });

  it('takes a name back off a deleted tag', async () => {
    const work = await createTag({ name: 'work' }, db);
    await deleteTag(work, db);
    const second = await createTag({ name: 'home' }, db);

    expect(await renameTag(second, 'work', db)).toBe('ok');
  });

  it('deletes a tag off every task carrying it', async () => {
    const work = await createTag({ name: 'work' }, db);
    const home = await createTag({ name: 'home' }, db);
    const one = await createTask({ title: 'Draft the deck', tagIds: [work, home] }, db);
    const two = await createTask({ title: 'Book the room', tagIds: [work] }, db);

    const touched = await deleteTag(work, db);

    expect(new Set(touched)).toEqual(new Set([one, two]));
    // A task left pointing at a tombstone shows a tag with no name and cannot
    // be untagged.
    expect((await db.tasks.get(one))!._tagIds).toEqual([home]);
    expect((await db.tasks.get(two))!._tagIds).toEqual([]);
    expect(await taggedWith(work, db)).toHaveLength(0);
    expect((await tagOptions(db)).map((tag) => tag.id)).toEqual([home]);
  });

  it('puts a deleted tag back on the tasks it came off', async () => {
    const work = await createTag({ name: 'work' }, db);
    const id = await createTask({ title: 'Draft the deck', tagIds: [work] }, db);

    const touched = await deleteTag(work, db);
    await restoreTag(work, touched, db);

    expect((await db.tasks.get(id))!._tagIds).toEqual([work]);
    expect((await tagOptions(db)).map((tag) => tag.id)).toEqual([work]);
  });

  it('counts open tasks per tag and skips the finished ones', async () => {
    const work = await createTag({ name: 'work' }, db);
    const home = await createTag({ name: 'home' }, db);
    const done = await createTask({ title: 'Send the invoice', tagIds: [work] }, db);
    await createTask({ title: 'Draft the deck', tagIds: [work, home] }, db);
    await completeTask(done, true, db);

    const counts = await tagCounts(db);

    expect(counts.get(work)).toBe(1);
    expect(counts.get(home)).toBe(1);
    // Absent rather than zero: the screen reads it with ?? 0, and a tag nobody
    // has used has nothing to count.
    expect(counts.has('nothing')).toBe(false);
  });

  it('counts and lists the same tasks, subtasks under their parent', async () => {
    // Every other list query drops subtasks because they render under their
    // parent. This one did not, so a tagged child appeared as its own row AND
    // nested under the parent, two nodes carrying one id, over a count that
    // disagreed with both.
    const errands = await createTag({ name: 'errands' }, db);
    const parent = await createTask({ title: 'Move house', tagIds: [errands] }, db);
    await createTask(
      { title: 'Pack the kitchen', parentTaskId: parent, tagIds: [errands] },
      db,
    );

    expect((await taggedWith(errands, db)).map((t) => t.title)).toEqual(['Move house']);
    expect((await tagCounts(db)).get(errands)).toBe(1);
  });

  it('relinks to the live tag rather than pushing a name twice', async () => {
    // Delete #work, type "Buy milk #work" before the toast expires, then undo.
    // An undelete would raise 23505 out of sync_push, which has no exception
    // block on that arm, and the whole claimed batch would deadletter.
    const first = await createTag({ name: 'work' }, db);
    const id = await createTask({ title: 'Draft the deck', tagIds: [first] }, db);
    const touched = await deleteTag(first, db);
    const second = await ensureTag('work', db);
    expect(second).not.toBe(first);

    expect(await restoreTag(first, touched, db)).toBe('merged');

    expect((await db.tags.get(first))!._del).toBe(1);
    expect((await db.tasks.get(id))!._tagIds).toEqual([second]);
    // Nothing in the outbox may undelete the tombstone.
    const records = await db.outbox.toArray();
    expect(records.filter((r) => r.op === 'undelete')).toEqual([]);
  });

  it('says when the tag it was asked to restore has gone', async () => {
    expect(await restoreTag('nope', [], db)).toBe('gone');
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

  it('finds a task by the name of a tag on it', async () => {
    // The gap this closes: the palette listed #work as somewhere to jump to and
    // searching "work" returned nothing that carried it.
    const work = await createTag({ name: 'work' }, db);
    const tagged = await createTask({ title: 'Draft the deck', tagIds: [work] }, db);
    await createTask({ title: 'Buy milk' }, db);

    expect((await searchTasks('work', 50, db)).map((t) => t.id)).toEqual([tagged]);
    // A prefix of the name, the same way a title matches.
    expect((await searchTasks('wor', 50, db)).map((t) => t.id)).toEqual([tagged]);
  });

  it('lets a tag satisfy one term of several', async () => {
    const work = await createTag({ name: 'work' }, db);
    const both = await createTask({ title: 'Draft the deck', tagIds: [work] }, db);
    await createTask({ title: 'Draft the letter' }, db);
    await createTask({ title: 'Read the deck', tagIds: [work] }, db);

    // "draft" from the title, "work" from the tag. Terms still AND.
    expect((await searchTasks('draft work', 50, db)).map((t) => t.id)).toEqual([both]);
  });

  it('does not turn a renamed tag into a stale index entry', async () => {
    // The reason the names are resolved at query time rather than written into
    // `_words`: nothing about the task changes when the tag is renamed.
    const tag = await createTag({ name: 'work' }, db);
    const id = await createTask({ title: 'Draft the deck', tagIds: [tag] }, db);

    expect(await renameTag(tag, 'admin', db)).toBe('ok');

    expect(await searchTasks('work', 50, db)).toHaveLength(0);
    expect((await searchTasks('admin', 50, db)).map((t) => t.id)).toEqual([id]);
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

/**
 * The read a saved view filters over.
 *
 * Bounded, because `toArray()` on tasks is banned: it deserializes the whole
 * store on the main thread. The bound is reported rather than applied in
 * silence, since it walks the tombstone index in primary-key order, so a
 * truncated read is the OLDEST n rows and everything newer is invisible. A view
 * that quietly omits half your tasks is worse than one that admits it.
 */
describe('view candidates', () => {
  it('says nothing was left out when the store fits', async () => {
    await createTask({ title: 'One' }, db);
    await createTask({ title: 'Two' }, db);

    const { tasks, truncated } = await viewCandidates(VIEW_CANDIDATE_LIMIT, db);
    expect(tasks).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it('reports the cap when it bites, rather than trimming quietly', async () => {
    for (let i = 0; i < 4; i++) await createTask({ title: `Task ${i}` }, db);

    const { tasks, truncated } = await viewCandidates(3, db);
    expect(tasks).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it('is exact at the boundary, so a full store does not read as truncated', async () => {
    for (let i = 0; i < 3; i++) await createTask({ title: `Task ${i}` }, db);

    const { tasks, truncated } = await viewCandidates(3, db);
    expect(tasks).toHaveLength(3);
    expect(truncated).toBe(false);
  });

  it('leaves tombstones out entirely', async () => {
    const id = await createTask({ title: 'Gone' }, db);
    await createTask({ title: 'Here' }, db);
    await deleteTask(id, db);

    const { tasks } = await viewCandidates(VIEW_CANDIDATE_LIMIT, db);
    expect(tasks.map((t) => t.title)).toEqual(['Here']);
  });
});

/**
 * The children of a page of parents, in one go.
 *
 * Every list query drops subtasks from the top level and says they render
 * underneath their parent, so this is the read that makes that true. A hook per
 * row would be a live query per row.
 */
describe('subtasks for a page of parents', () => {
  it('groups children under the right parent', async () => {
    const a = await createTask({ title: 'Move flat' }, db);
    const b = await createTask({ title: 'Do taxes' }, db);
    await createTask({ title: 'Pack kitchen', parentTaskId: a }, db);
    await createTask({ title: 'Book a van', parentTaskId: a }, db);
    await createTask({ title: 'Find receipts', parentTaskId: b }, db);

    const map = await subtasksForParents([a, b], db);
    expect(map.get(a)?.map((t) => t.title)).toEqual(['Pack kitchen', 'Book a van']);
    expect(map.get(b)?.map((t) => t.title)).toEqual(['Find receipts']);
  });

  it('leaves a childless parent out entirely rather than giving it an empty list', async () => {
    const lonely = await createTask({ title: 'Nothing under this' }, db);
    const map = await subtasksForParents([lonely], db);
    expect(map.has(lonely)).toBe(false);
  });

  it('asks for nothing when the page is empty', async () => {
    expect(await subtasksForParents([], db)).toEqual(new Map());
  });

  it('keeps a completed child, so the count can say 1/2', async () => {
    const parent = await createTask({ title: 'Move flat' }, db);
    const first = await createTask({ title: 'Pack kitchen', parentTaskId: parent }, db);
    await createTask({ title: 'Book a van', parentTaskId: parent }, db);
    await completeTask(first, true, db);

    const children = (await subtasksForParents([parent], db)).get(parent)!;
    expect(children).toHaveLength(2);
    expect(children.filter((t) => t._done === 1)).toHaveLength(1);
  });

  it('drops a deleted child', async () => {
    const parent = await createTask({ title: 'Move flat' }, db);
    const child = await createTask({ title: 'Pack kitchen', parentTaskId: parent }, db);
    await deleteTask(child, db);

    expect((await subtasksForParents([parent], db)).has(parent)).toBe(false);
  });

  it('never shows a subtask at the top level as well', async () => {
    // The lists already promise this. Both halves are asserted together so a
    // change to either one cannot start showing the same work twice.
    const parent = await createTask({ title: 'Move flat' }, db);
    await createTask({ title: 'Pack kitchen', parentTaskId: parent }, db);

    const top = await inboxList(db);
    expect(top.map((t) => t.title)).toEqual(['Move flat']);
    expect((await subtasksForParents(top.map((t) => t.id), db)).get(parent)).toHaveLength(1);
  });
});

describe('projects', () => {
  it('gives each new one a different colour without being asked', async () => {
    // Quick-add writes `@kitchen` and never opens the editor, so if the default
    // were one hex every dot on the screen would identify nothing.
    const ids = [
      await createProject({ name: 'One' }, db),
      await createProject({ name: 'Two' }, db),
      await createProject({ name: 'Three' }, db),
    ];
    const colors = await Promise.all(ids.map(async (id) => (await db.projects.get(id))!.color));
    expect(new Set(colors).size).toBe(3);
  });

  it('keeps a colour somebody actually picked', async () => {
    // The editor omits `color` until a swatch is clicked, precisely so the
    // rotation above happens here rather than being guessed from a live query
    // that has not settled. An explicit choice still has to win.
    const id = await createProject({ name: 'One', color: '#4A8CC1' }, db);
    expect((await db.projects.get(id))?.color).toBe('#4A8CC1');
  });

  it('takes an area at creation, so a New project inside one lands there', async () => {
    const area = await createArea({ name: 'Home' }, db);
    const id = await createProject({ name: 'Kitchen', areaId: area }, db);
    expect((await db.projects.get(id))?.areaId).toBe(area);
  });

  it('queues an update alongside the local write', async () => {
    const id = await createProject({ name: 'Kitchen' }, db);
    const before = await db.outbox.count();

    await updateProject(id, { name: 'Kitchen rewire', notes: 'Sparky booked' }, db);

    expect((await db.projects.get(id))?.name).toBe('Kitchen rewire');
    expect(await db.outbox.count()).toBe(before + 1);
    const queued = await db.outbox.orderBy('seq').last();
    expect(queued).toMatchObject({ table: 'projects', entityId: id, op: 'update' });
    expect(queued?.patch).toEqual({ name: 'Kitchen rewire', notes: 'Sparky booked' });
  });

  it('drops an archived project out of the pickers and keeps it on its own screen', async () => {
    const id = await createProject({ name: 'Kitchen' }, db);
    await setProjectArchived(id, true, db);

    // projectOptions feeds every picker in the app. Offering a finished project
    // there is how work gets filed back into one.
    expect((await projectOptions(db)).map((p) => p.id)).toEqual([]);
    expect((await allProjects(db)).map((p) => p.id)).toEqual([id]);
    expect((await db.projects.get(id))?._archived).toBe(1);

    await setProjectArchived(id, false, db);
    expect((await projectOptions(db)).map((p) => p.id)).toEqual([id]);
  });

  it('files its tasks back into the Inbox when it is deleted', async () => {
    // Without this they point at a tombstone and appear in no list at all:
    // Inbox is projectId === '' off an index, and Today and Upcoming key off the
    // due day, so a dateless task would be gone.
    const project = await createProject({ name: 'Kitchen' }, db);
    const filed = await createTask({ title: 'Order tiles', projectId: project }, db);
    const dateless = await createTask({ title: 'Choose grout', projectId: project }, db);

    const moved = await deleteProject(project, db);

    expect(new Set(moved.taskIds)).toEqual(new Set([filed, dateless]));
    expect(moved.open).toBe(2);
    expect((await db.projects.get(project))?._del).toBe(1);
    expect((await db.tasks.get(filed))?.projectId).toBe(NO_PROJECT);
    expect((await inboxList(db)).map((t) => t.id).sort()).toEqual([filed, dateless].sort());
  });

  it('puts the project and its tasks back together', async () => {
    const project = await createProject({ name: 'Kitchen' }, db);
    const filed = await createTask({ title: 'Order tiles', projectId: project }, db);

    const moved = await deleteProject(project, db);
    await restoreProject(project, moved.taskIds, db);

    expect((await db.projects.get(project))?._del).toBe(0);
    expect((await projectList(project, db)).map((t) => t.id)).toEqual([filed]);
    expect((await inboxList(db)).map((t) => t.id)).toEqual([]);
  });

  it('leaves a subtask alone, because its parent carries the project', async () => {
    const project = await createProject({ name: 'Kitchen' }, db);
    const parent = await createTask({ title: 'Order tiles', projectId: project }, db);
    const child = await createTask({ title: 'Measure the wall', parentTaskId: parent }, db);

    const moved = await deleteProject(project, db);

    expect(moved.taskIds).toEqual([parent]);
    // It never had a project of its own to lose.
    expect((await db.tasks.get(child))?.projectId).toBe(NO_PROJECT);
    expect((await subtasksOf(parent, db)).map((t) => t.id)).toEqual([child]);
  });

  it('does not resurrect a task that was already deleted', async () => {
    const project = await createProject({ name: 'Kitchen' }, db);
    const gone = await createTask({ title: 'Old idea', projectId: project }, db);
    await deleteTask(gone, db);

    expect(await deleteProject(project, db)).toEqual({ taskIds: [], open: 0 });
    expect((await db.tasks.get(gone))?._del).toBe(1);
  });

  it('stamps completedAt locally when a project turns done', async () => {
    // completed_at is server-owned, so the patch cannot carry it and 0020's
    // trigger fills it on the way in. Signed out there is no next pull, and this
    // is the only thing that ever sets it.
    const id = await createProject({ name: 'Kitchen' }, db);
    expect((await db.projects.get(id))?.completedAt).toBeNull();

    await updateProject(id, { status: 'done' }, db);
    expect((await db.projects.get(id))?.completedAt).not.toBeNull();

    await updateProject(id, { status: 'active' }, db);
    expect((await db.projects.get(id))?.completedAt).toBeNull();
  });

  it('leaves a cancelled project without a completion date', async () => {
    const id = await createProject({ name: 'Kitchen' }, db);
    await updateProject(id, { status: 'cancelled' }, db);
    expect((await db.projects.get(id))?.completedAt).toBeNull();
  });

  it('never sends completedAt to the server', async () => {
    const id = await createProject({ name: 'Kitchen' }, db);
    await updateProject(id, { status: 'done' }, db);
    const queued = await db.outbox.orderBy('seq').last();
    expect(queued?.patch).toEqual({ status: 'done' });
  });

  it('reports the open count separately from every task it moved', async () => {
    // The Inbox lists open work, so a message promising ten tasks in an Inbox
    // that will show two is a lie about where they went.
    const project = await createProject({ name: 'Kitchen' }, db);
    const open = await createTask({ title: 'Order tiles', projectId: project }, db);
    const finished = await createTask({ title: 'Book sparky', projectId: project }, db);
    await completeTask(finished, true, db);

    const moved = await deleteProject(project, db);

    expect(new Set(moved.taskIds)).toEqual(new Set([open, finished]));
    expect(moved.open).toBe(1);
    // Both moved, so undo can put both back, and only one shows up.
    expect((await inboxList(db)).map((t) => t.id)).toEqual([open]);
  });

  it('counts open and done per project, excluding subtasks', async () => {
    const project = await createProject({ name: 'Kitchen' }, db);
    const other = await createProject({ name: 'Garden' }, db);
    const first = await createTask({ title: 'Order tiles', projectId: project }, db);
    await createTask({ title: 'Book sparky', projectId: project }, db);
    // A subtask would double-count its parent: it carries no project of its own.
    await createTask({ title: 'Measure', parentTaskId: first }, db);
    await completeTask(first, true, db);

    const counts = await projectCounts([project, other], db);
    expect(counts.get(project)).toEqual({ open: 1, done: 1 });
    expect(counts.get(other)).toEqual({ open: 0, done: 0 });
    expect((await projectDone(project, 50, db)).map((t) => t.id)).toEqual([first]);
  });

  it('pages the finished list rather than capping it', async () => {
    // The screen used to read one page of 50 and say that was the total, so a
    // project with a year behind it had a wall nothing on the page mentioned.
    const project = await createProject({ name: 'Move house' }, db);
    for (let i = 0; i < 4; i++) {
      const id = await createTask({ title: `Box ${i}`, projectId: project }, db);
      await completeTask(id, true, db);
    }

    const page = await projectDone(project, 2, db);
    const all = await projectDone(project, 10, db);

    expect(page).toHaveLength(2);
    expect(all).toHaveLength(4);
    // A bigger limit extends the same list rather than reshuffling it, which is
    // what makes "show more" append instead of jump.
    expect(page.map((t) => t.id)).toEqual(all.slice(0, 2).map((t) => t.id));
    // The count the disclosure quotes comes from here, and it is not the page.
    expect((await projectCounts([project], db)).get(project)).toEqual({ open: 0, done: 4 });
  });
});

describe('a cancelled task in a project', () => {
  it('counts as neither open nor done', async () => {
    // `_done` is 1 for done OR cancelled, because both leave the open lists, so
    // the index range alone would report an abandoned task as finished and the
    // ring would say the project is further along than it is.
    const project = await createProject({ name: 'Kitchen' }, db);
    const done = await createTask({ title: 'Order tiles', projectId: project }, db);
    const dropped = await createTask({ title: 'Hire a designer', projectId: project }, db);
    const open = await createTask({ title: 'Choose grout', projectId: project }, db);
    await completeTask(done, true, db);
    await updateTask(dropped, { status: 'cancelled' }, db);

    expect(await projectCounts([project], db)).toEqual(
      new Map([[project, { open: 1, done: 1 }]]),
    );
    expect((await projectList(project, db)).map((t) => t.id)).toEqual([open]);
  });

  it('stays out of the done list', async () => {
    const project = await createProject({ name: 'Kitchen' }, db);
    const done = await createTask({ title: 'Order tiles', projectId: project }, db);
    const dropped = await createTask({ title: 'Hire a designer', projectId: project }, db);
    await completeTask(done, true, db);
    await updateTask(dropped, { status: 'cancelled' }, db);

    // A list headed "Done" holding work somebody abandoned is mislabelled.
    expect((await projectDone(project, 50, db)).map((t) => t.id)).toEqual([done]);
  });
});

describe('areas', () => {
  it('creates one and queues the insert', async () => {
    const before = await db.outbox.count();
    const id = await createArea({ name: 'Home' }, db);

    expect((await areaOptions(db)).map((a) => a.id)).toEqual([id]);
    expect(await db.outbox.count()).toBe(before + 1);
    expect(await db.outbox.orderBy('seq').last()).toMatchObject({
      table: 'areas',
      entityId: id,
      op: 'insert',
    });
  });

  it('renames one', async () => {
    const id = await createArea({ name: 'Home' }, db);
    await updateArea(id, { name: 'House' }, db);
    expect((await db.areas.get(id))?.name).toBe('House');
  });

  it('keeps the projects when the area goes', async () => {
    // Postgres would clear area_id through `on delete set null`, but a soft
    // delete never fires it, so the projects would point at a tombstone and fall
    // out of every group on the screen.
    const area = await createArea({ name: 'Home' }, db);
    const project = await createProject({ name: 'Kitchen', areaId: area }, db);

    const unfiled = await deleteArea(area, db);

    expect(unfiled).toEqual([project]);
    expect((await db.areas.get(area))?._del).toBe(1);
    expect((await db.projects.get(project))?.areaId).toBe('');
    expect((await allProjects(db)).map((p) => p.id)).toEqual([project]);
  });

  it('refiles them on a restore', async () => {
    const area = await createArea({ name: 'Home' }, db);
    const project = await createProject({ name: 'Kitchen', areaId: area }, db);

    const unfiled = await deleteArea(area, db);
    await restoreArea(area, unfiled, db);

    expect((await db.areas.get(area))?._del).toBe(0);
    expect((await db.projects.get(project))?.areaId).toBe(area);
  });

  it('orders them by their own sort key', async () => {
    const first = await createArea({ name: 'Home' }, db);
    const second = await createArea({ name: 'Work' }, db);
    expect((await areaOptions(db)).map((a) => a.id)).toEqual([first, second]);
  });

  it('reorders one by touching a single row', async () => {
    const home = await createArea({ name: 'Home' }, db);
    const work = await createArea({ name: 'Work' }, db);
    const side = await createArea({ name: 'Side' }, db);
    await db.outbox.clear();

    // Side to the top: between nothing and Home.
    const keys = (await areaOptions(db)).map((a) => a.sortKey);
    await reorderArea(side, null, keys[0]!, db);

    expect((await areaOptions(db)).map((a) => a.id)).toEqual([side, home, work]);

    // One row, one field. Two devices reordering different parts of the list is
    // the case fractional indexing exists for, and it only holds while a move
    // writes nothing but its own rank.
    const records = await db.outbox.toArray();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ table: 'areas', entityId: side, op: 'update' });
    expect(Object.keys(records[0]!.patch)).toEqual(['sortKey']);
  });
});

describe('reordering a project', () => {
  it('moves it and leaves its neighbours where they were', async () => {
    // reorderProject shipped with the projects screen and had no caller until
    // the index grew carets, so this is the first time the write runs.
    const first = await createProject({ name: 'Kitchen' }, db);
    const second = await createProject({ name: 'Garden' }, db);
    const third = await createProject({ name: 'Loft' }, db);

    const keys = (await allProjects(db)).map((p) => p.sortKey);
    // Loft up one place: between Kitchen and Garden.
    await reorderProject(third, keys[0]!, keys[1]!, db);
    expect((await allProjects(db)).map((p) => p.id)).toEqual([first, third, second]);

    await db.outbox.clear();
    // And to the very top, where there is no rank before it.
    const moved = (await allProjects(db)).map((p) => p.sortKey);
    await reorderProject(second, null, moved[0]!, db);
    expect((await allProjects(db)).map((p) => p.id)).toEqual([second, first, third]);

    const records = await db.outbox.toArray();
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0]!.patch)).toEqual(['sortKey']);
  });
});

describe('one task\'s history', () => {
  it('reads back newest first, and only this task', async () => {
    const mine = await createTask({ title: 'Buy oat milk' }, db);
    const other = await createTask({ title: 'Renew passport' }, db);
    await updateTask(mine, { priority: 3 }, db);
    await completeTask(mine, true, db);
    await updateTask(other, { priority: 1 }, db);

    const history = await taskHistory(mine, 10, db);

    expect(history.map((e) => e.action)).toEqual(['complete', 'update', 'create']);
    expect(new Set(history.map((e) => e.entityId))).toEqual(new Set([mine]));
  });

  it('keeps an entry that was taken back, marked', async () => {
    const id = await createTask({ title: 'Buy oat milk' }, db);
    await completeTask(id, true, db);
    await undoLast(db);

    const history = await taskHistory(id, 10, db);
    expect(history.map((e) => e.action)).toEqual(['complete', 'create']);
    expect(history[0]?._undone).toBe(1);
  });

  it('honours the limit, taking the newest', async () => {
    const id = await createTask({ title: 'Buy oat milk' }, db);
    await updateTask(id, { priority: 1 }, db);
    await updateTask(id, { priority: 2 }, db);

    const history = await taskHistory(id, 2, db);
    expect(history).toHaveLength(2);
    expect(history.map((e) => e.after.priority)).toEqual([2, 1]);
  });
});

describe('a start date holds a task back', () => {
  it('keeps a task out of Today until the day it starts', async () => {
    const id = await createTask({ title: 'Term paper', dueDate: TODAY }, db);
    expect((await todayList(TODAY, db)).map((t) => t.id)).toEqual([id]);

    await updateTask(id, { startDate: addDays(TODAY, 7) }, db);
    expect(await todayList(TODAY, db)).toHaveLength(0);
    expect((await todayDeferred(TODAY, db)).map((t) => t.id)).toEqual([id]);
  });

  it('lets it back in on the day itself', async () => {
    const id = await createTask({ title: 'Starts today', dueDate: TODAY }, db);
    await updateTask(id, { startDate: TODAY }, db);

    // The boundary is inclusive. "Starts today" has started.
    expect((await todayList(TODAY, db)).map((t) => t.id)).toEqual([id]);
    expect(await todayDeferred(TODAY, db)).toHaveLength(0);
  });

  it('keeps a deferred capture out of the Inbox', async () => {
    const id = await createTask({ title: 'Later thought' }, db);
    await updateTask(id, { startDate: addDays(TODAY, 3) }, db);

    expect(await inboxList(db, TODAY)).toHaveLength(0);
    expect((await inboxDeferred(db, TODAY)).map((t) => t.id)).toEqual([id]);
  });

  it('keeps a deferred dateless task out of Someday', async () => {
    const id = await createTask({ title: 'Parked' }, db);
    await updateTask(id, { startDate: addDays(TODAY, 30) }, db);

    expect(await somedayList(db, TODAY)).toHaveLength(0);
    expect((await somedayDeferred(db, TODAY)).map((t) => t.id)).toEqual([id]);
  });

  it('leaves it on Upcoming, which is the screen meant to warn you', async () => {
    const id = await createTask({ title: 'Proposal', dueDate: addDays(TODAY, 14) }, db);
    await updateTask(id, { startDate: addDays(TODAY, 7) }, db);

    expect((await upcomingList(TODAY, 30, db)).map((t) => t.id)).toEqual([id]);
  });

  it('leaves a task with no start date alone', async () => {
    const id = await createTask({ title: 'Plain', dueDate: TODAY }, db);
    expect((await todayList(TODAY, db)).map((t) => t.id)).toEqual([id]);
    expect(await todayDeferred(TODAY, db)).toHaveLength(0);
  });
});

describe('cancelling a task', () => {
  it('takes it off the open lists and puts it in the cancelled pile', async () => {
    const id = await createTask({ title: 'Optional problem set', dueDate: TODAY }, db);
    expect((await todayList(TODAY, db)).map((t) => t.id)).toEqual([id]);

    await cancelTasks([id], 'skipped', db);

    expect(await todayList(TODAY, db)).toHaveLength(0);
    expect((await cancelledList(100, db)).map((t) => t.id)).toEqual([id]);
  });

  it('keeps it out of the logbook, which is finished work', async () => {
    const cancelled = await createTask({ title: 'Dropped', dueDate: TODAY }, db);
    const done = await createTask({ title: 'Finished', dueDate: TODAY }, db);

    await cancelTasks([cancelled], 'obsolete', db);
    await completeTask(done, true, db);

    // The whole reason cancelled_at is its own column. A cancellation in here
    // would count toward the streak and the weekly review.
    expect((await logbook(100, db)).map((t) => t.id)).toEqual([done]);
  });

  it('records the reason', async () => {
    const id = await createTask({ title: 'Same as the other one' }, db);
    await cancelTasks([id], 'duplicate', db);

    const row = await taskById(id, db);
    expect(row!.status).toBe('cancelled');
    expect(row!.cancelReason).toBe('duplicate');
    expect(row!.cancelledAt).not.toBeNull();
  });

  it('stamps cancelledAt locally, so the pile works offline', async () => {
    // Server-owned, so no patch carries it and no pull is coming. Without the
    // optimistic stamp the row leaves the open lists and reaches nothing.
    const id = await createTask({ title: 'Offline drop' }, db);
    await cancelTasks([id], 'other', db);

    const queued = await db.outbox.toArray();
    const patches = queued.filter((o) => 'cancelledAt' in (o.patch as object));
    expect(patches).toEqual([]);
    expect((await taskById(id, db))!.cancelledAt).not.toBeNull();
  });

  it('cancels several as one undo step', async () => {
    const a = await createTask({ title: 'One' }, db);
    const b = await createTask({ title: 'Two' }, db);
    await cancelTasks([a, b], 'obsolete', db);

    expect((await cancelledList(100, db)).map((t) => t.id).sort()).toEqual([a, b].sort());

    await undoLast(db);
    expect(await cancelledList(100, db)).toHaveLength(0);
    expect((await inboxList(db, TODAY)).map((t) => t.id).sort()).toEqual([a, b].sort());
  });

  it('leaves an already cancelled task alone', async () => {
    const id = await createTask({ title: 'Twice' }, db);
    await cancelTasks([id], 'other', db);
    const first = (await taskById(id, db))!.cancelledAt;

    await cancelTasks([id], 'duplicate', db);

    const row = await taskById(id, db);
    expect(row!.cancelledAt).toBe(first);
    expect(row!.cancelReason).toBe('other');
  });

  it('drops the reason when the row is unchecked back into the list', async () => {
    // The pile shows a checkbox, and unchecking it is a reopen. A task back on
    // the list carrying "duplicate" is a field that outlived its subject.
    const id = await createTask({ title: 'Unchecked' }, db);
    await cancelTasks([id], 'duplicate', db);

    await completeTask(id, false, db);

    const row = await taskById(id, db);
    expect(row!.status).toBe('active');
    expect(row!.cancelReason).toBeNull();
    expect(row!.cancelledAt).toBeNull();
  });

  it('puts one back on the list it came from', async () => {
    const id = await createTask({ title: 'Kept after all' }, db);
    await cancelTasks([id], 'other', db);
    await uncancelTasks([id], db);

    const row = await taskById(id, db);
    expect(row!.status).toBe('active');
    expect(row!.cancelReason).toBeNull();
    expect(row!.cancelledAt).toBeNull();
    expect(await cancelledList(100, db)).toHaveLength(0);
  });
});
