// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { setDb, TendDb } from '@/lib/db/client';
import { createTask, setTaskRecurrence, updateTask } from '@/lib/db/mutations';
import { addDays, today } from '@/lib/db/queries';
import type { RecurrenceRule } from '@/lib/recurrence';
import { useRollRepeats } from './use-roll-repeats';

const DAILY: RecurrenceRule = {
  freq: 'daily',
  interval: 1,
  anchorMode: 'due_date',
  catchupPolicy: 'skip_to_future',
  endsMode: 'never',
};

let db: TendDb;
let name: string;
let n = 0;

beforeEach(async () => {
  name = `tend_roll_${Date.now()}_${n++}`;
  db = new TendDb(name);
  setDb(db);
  await db.open();
});

afterEach(async () => {
  cleanup();
  db.close();
  setDb(null);
  await Dexie.delete(name);
});

const TODAY = today();

describe('useRollRepeats', () => {
  it('rolls a missed daily task on mount', async () => {
    const id = await createTask({ title: 'Stretch', dueDate: addDays(TODAY, -2) }, db);
    await setTaskRecurrence(id, DAILY, db);

    renderHook(() => useRollRepeats());

    await waitFor(async () => expect((await db.tasks.get(id))?.dueDate).toBe(TODAY));
  });

  it('rolls one that turns up after mount, as a sync pull delivers it', async () => {
    renderHook(() => useRollRepeats());

    const id = await createTask({ title: 'Stretch', dueDate: TODAY }, db);
    await setTaskRecurrence(id, DAILY, db);
    // Another device's row, still dated two days back.
    await updateTask(id, { dueDate: addDays(TODAY, -2), occurrenceDate: addDays(TODAY, -2) }, db);

    await waitFor(async () => expect((await db.tasks.get(id))?.dueDate).toBe(TODAY));
  });

  it('leaves a keep_backlog repeat alone', async () => {
    const id = await createTask({ title: 'Log a run', dueDate: addDays(TODAY, -2) }, db);
    await setTaskRecurrence(id, { ...DAILY, catchupPolicy: 'keep_backlog' }, db);
    const queued = await db.outbox.count();

    renderHook(() => useRollRepeats());
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect((await db.tasks.get(id))?.dueDate).toBe(addDays(TODAY, -2));
    expect(await db.outbox.count()).toBe(queued);
  });
});
