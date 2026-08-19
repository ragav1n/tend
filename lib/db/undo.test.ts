import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { setDb, TendDb } from './client';
import {
  completeTask,
  createTask,
  deleteTask,
  deleteTasks,
  restoreTask,
  setTaskRecurrence,
  updateTask,
  updateTasks,
} from './mutations';
import { today } from './queries';
import { describeGroup, nextUndoGroup, undoLast } from './undo';

let db: TendDb;
let dbName: string;
let counter = 0;

beforeEach(async () => {
  dbName = `tend_undo_${Date.now()}_${counter++}`;
  db = new TendDb(dbName);
  setDb(db);
  await db.open();
});

afterEach(async () => {
  db.close();
  setDb(null);
  await Dexie.delete(dbName);
});

// Sorted by id, which is UUIDv7 and therefore in write order even when two
// entries land in the same millisecond.
const DAILY = {
  freq: 'daily' as const,
  interval: 3,
  anchorMode: 'due_date' as const,
  catchupPolicy: 'skip_to_future' as const,
  endsMode: 'never' as const,
};

const entries = async () =>
  (await db.activityLog.toArray()).sort((a, b) => a.id.localeCompare(b.id));

describe('what gets recorded', () => {
  it('writes one entry per task mutation', async () => {
    const id = await createTask({ title: 'Book the dentist' }, db);
    await updateTask(id, { priority: 2 }, db);
    await completeTask(id, true, db);

    expect((await entries()).map((e) => e.action)).toEqual(['create', 'update', 'complete']);
  });

  it('keeps the values a patch replaced', async () => {
    const id = await createTask({ title: 'Pay rent', priority: 1 }, db);
    await updateTask(id, { priority: 3, title: 'Pay the rent' }, db);

    const entry = (await entries())[1]!;
    expect(entry.before).toEqual({ priority: 1, title: 'Pay rent' });
    expect(entry.after).toEqual({ priority: 3, title: 'Pay the rent' });
  });

  it('gives one gesture over many tasks one group', async () => {
    const a = await createTask({ title: 'A' }, db);
    const b = await createTask({ title: 'B' }, db);
    await updateTasks([a, b], { priority: 3 }, db);

    const updates = (await entries()).filter((e) => e.action === 'update');
    expect(updates).toHaveLength(2);
    expect(new Set(updates.map((e) => e.groupId)).size).toBe(1);
  });

  it('leaves separate gestures in separate groups', async () => {
    const id = await createTask({ title: 'A' }, db);
    await updateTask(id, { priority: 1 }, db);
    await updateTask(id, { priority: 2 }, db);

    expect(new Set((await entries()).map((e) => e.groupId)).size).toBe(3);
  });

  it('does not record a reorder, which undoes itself by dragging back', async () => {
    const a = await createTask({ title: 'A' }, db);
    await createTask({ title: 'B' }, db);
    const before = (await entries()).length;

    const { reorderTask } = await import('./mutations');
    await reorderTask(a, 'a1', null, 'sortKey', db);

    expect((await entries()).length).toBe(before);
  });

  it('does not record turning recurrence on, which it could only half undo', async () => {
    const id = await createTask({ title: 'Water the plants', dueDate: today() }, db);
    const before = (await entries()).length;

    await setTaskRecurrence(id, DAILY, db);

    // Restoring seriesId while the series row it points at survived would be a
    // half undo, so the whole gesture stays out of the stack.
    expect((await entries()).length).toBe(before);
  });
});

describe('undo', () => {
  it('takes back an edit', async () => {
    const id = await createTask({ title: 'Call the plumber', priority: 0 }, db);
    await updateTask(id, { priority: 3 }, db);

    expect(await undoLast(db)).toBe('Edited "Call the plumber"');
    expect((await db.tasks.get(id))?.priority).toBe(0);
  });

  it('takes back a create by deleting the task', async () => {
    const id = await createTask({ title: 'Typed by mistake' }, db);

    expect(await undoLast(db)).toBe('Added "Typed by mistake"');
    expect((await db.tasks.get(id))?._del).toBe(1);
  });

  it('takes back a delete by restoring it', async () => {
    const id = await createTask({ title: 'Cancel the gym' }, db);
    await deleteTask(id, db);

    expect(await undoLast(db)).toBe('Deleted "Cancel the gym"');
    expect((await db.tasks.get(id))?._del).toBe(0);
  });

  it('takes back a restore by deleting again', async () => {
    const id = await createTask({ title: 'Cancel the gym' }, db);
    await deleteTask(id, db);
    await restoreTask(id, db);

    await undoLast(db);
    expect((await db.tasks.get(id))?._del).toBe(1);
  });

  it('takes back a whole bulk gesture, not one row of it', async () => {
    const a = await createTask({ title: 'A', priority: 0 }, db);
    const b = await createTask({ title: 'B', priority: 1 }, db);
    await updateTasks([a, b], { priority: 3 }, db);

    expect(await undoLast(db)).toBe('2 changes');
    expect((await db.tasks.get(a))?.priority).toBe(0);
    expect((await db.tasks.get(b))?.priority).toBe(1);
  });

  it('walks back one gesture at a time', async () => {
    const id = await createTask({ title: 'Draft the update', priority: 0 }, db);
    await updateTask(id, { priority: 1 }, db);
    await updateTask(id, { priority: 3 }, db);

    await undoLast(db);
    expect((await db.tasks.get(id))?.priority).toBe(1);
    await undoLast(db);
    expect((await db.tasks.get(id))?.priority).toBe(0);
    await undoLast(db);
    expect((await db.tasks.get(id))?._del).toBe(1);
  });

  it('marks what it took back, so the next undo skips it', async () => {
    const id = await createTask({ title: 'A' }, db);
    await updateTask(id, { priority: 2 }, db);
    await undoLast(db);

    const undone = (await entries()).filter((e) => e._undone === 1);
    expect(undone).toHaveLength(1);
    expect(undone[0]!.action).toBe('update');
    // And it writes no new history of its own, or the next undo would redo it.
    expect((await entries()).map((e) => e.action)).toEqual(['create', 'update']);
  });

  it('says so when there is nothing left', async () => {
    expect(await undoLast(db)).toBeNull();
  });

  it('takes the next occurrence back with the completion that made it', async () => {
    const id = await createTask({ title: 'Water the plants', dueDate: today() }, db);
    await setTaskRecurrence(id, DAILY, db);
    await completeTask(id, true, db);

    const open = (await db.tasks.toArray()).filter((t) => t._del === 0 && t._done === 0);
    expect(open).toHaveLength(1);

    await undoLast(db);

    // Back to one open occurrence, which is the promise a series makes.
    const after = (await db.tasks.toArray()).filter((t) => t._del === 0 && t._done === 0);
    expect(after.map((t) => t.id)).toEqual([id]);
  });

  it('lands on the oldest value when one gesture wrote a field twice', async () => {
    const a = await createTask({ title: 'A', priority: 0 }, db);
    // Two entries in one group over the same field, both written inside one
    // millisecond, which is what makes createdAt useless for ordering them.
    await updateTasks([a, a], { priority: 3 }, db);

    await undoLast(db);
    expect((await db.tasks.get(a))?.priority).toBe(0);
  });
});

describe('the stack', () => {
  it('offers the newest gesture still standing', async () => {
    const a = await createTask({ title: 'A' }, db);
    await deleteTasks([a], db);

    const group = await nextUndoGroup(db);
    expect(group.map((e) => e.action)).toEqual(['delete']);
  });

  it('describes a group by its own summary when it holds one entry', async () => {
    const id = await createTask({ title: 'Only one' }, db);
    expect(describeGroup(await nextUndoGroup(db))).toBe('Added "Only one"');
    void id;
  });

  it('describes an empty group as nothing to undo', () => {
    expect(describeGroup([])).toBe('Nothing to undo');
  });
});
