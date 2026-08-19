// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { setDb, TendDb } from './client';
import { CONFLICT_LOG_CAP, relieveQuota, requestPersistence, storageReport } from './persist';

/**
 * Storage durability, and the exit from `paused_quota`.
 *
 * The pruner is the interesting half. Freeing space is easy if deleting tasks is
 * allowed, and it is not: a pull is cursor-based, so a locally deleted synced row
 * is never fetched again and the hole in the Logbook is permanent. So the test
 * that matters is the one asserting it leaves the tasks alone and reports that it
 * freed nothing, which is what keeps the engine parked and the badge honest.
 */

let db: TendDb;
let dbName: string;
let counter = 0;

beforeEach(async () => {
  dbName = `tend_persist_test_${Date.now()}_${counter++}`;
  db = new TendDb(dbName);
  setDb(db);
  await db.open();
  localStorage.clear();
});

afterEach(async () => {
  db.close();
  setDb(null);
  await Dexie.delete(dbName);
  vi.unstubAllGlobals();
});

describe('asking to keep the data', () => {
  it('reports unsupported rather than throwing where the API is missing', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestPersistence()).toBe('unsupported');
    expect(await storageReport()).toBeNull();
  });

  it('takes an existing grant without prompting', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist } });

    expect(await requestPersistence()).toBe('granted');
    // The prompt is the whole cost of this call, and there was nothing to ask.
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks once, then stops asking', async () => {
    const persist = vi.fn(async () => false);
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } });

    expect(await requestPersistence()).toBe('denied');
    expect(await requestPersistence()).toBe('denied');
    // Firefox is the only browser that shows a dialog for this, and showing it
    // on every load would be its own bug.
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('notices a grant that arrived later on its own', async () => {
    // Which is what Chrome does once the app is installed. The second call has
    // to see it without prompting again.
    const persist = vi.fn(async () => false);
    let persisted = false;
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => persisted, persist },
    });

    expect(await requestPersistence()).toBe('denied');
    persisted = true;
    expect(await requestPersistence()).toBe('granted');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('reports usage as a ratio, and does not divide by a zero quota', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ usage: 250, quota: 1000 }) },
    });
    expect(await storageReport()).toEqual({ usage: 250, quota: 1000, ratio: 0.25 });

    vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } });
    expect(await storageReport()).toEqual({ usage: 0, quota: 0, ratio: 0 });
  });
});

describe('making room', () => {
  it('trims the conflict log to its cap, oldest first', async () => {
    const extra = 12;
    await db.conflicts.bulkAdd(
      Array.from({ length: CONFLICT_LOG_CAP + extra }, (_, index) => ({
        table: 'tasks',
        entityId: `t${index}`,
        at: 1_000 + index,
        droppedFields: ['title'],
      })),
    );

    expect(await relieveQuota(db)).toBe(extra);
    expect(await db.conflicts.count()).toBe(CONFLICT_LOG_CAP);

    // The ones kept are the recent ones, since "2 changes from another device
    // replaced yours" is only ever about the last few.
    const kept = await db.conflicts.orderBy('at').first();
    expect(kept?.at).toBe(1_000 + extra);
  });

  it('collects reminder rows whose task is gone', async () => {
    await db.reminderState.bulkPut([
      { taskId: 'alive', firedForAt: '2026-08-19T09:00' },
      { taskId: 'gone', firedForAt: '2026-08-19T09:00' },
    ]);
    await db.tasks.put({ id: 'alive' } as never);

    expect(await relieveQuota(db)).toBe(1);
    expect(await db.reminderState.toCollection().primaryKeys()).toEqual(['alive']);
  });

  it('leaves the tasks alone and admits it freed nothing', async () => {
    await db.tasks.bulkPut(
      Array.from({ length: 20 }, (_, index) => ({ id: `t${index}` }) as never),
    );
    await db.deadletter.put({
      mutationId: 'm1',
      table: 'tasks',
      entityId: 't1',
      createdAt: 1,
      reason: 'refused',
    });

    // Nothing prunable, so the honest answer is zero rather than a number bought
    // by deleting somebody's records.
    expect(await relieveQuota(db)).toBe(0);
    expect(await db.tasks.count()).toBe(20);
    // Work the server refused has landed nowhere. The badge exists to surface it.
    expect(await db.deadletter.count()).toBe(1);
  });
});
