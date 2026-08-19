// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie, { type PromiseExtended } from 'dexie';
import { TendDb } from './client';
import { openWithRecovery } from './recovery';
import type { OutboxRecord } from './types';

/**
 * The ladder, driven for real: a database is seeded, made unopenable, and the
 * ladder is asked to get the app running again.
 *
 * The rung that matters is the rescue. Everything else in the local store is a
 * copy of something Postgres holds, so losing it costs a resync. Unsent
 * mutations exist nowhere else, and an insert record carries the whole row, so
 * whether they survive a rebuild is the difference between a full recovery and
 * silently losing whatever was written since the last successful push.
 */

let dbName: string;
let counter = 0;

/** A handle whose open always fails with the named DOMException. */
function failingDb(name: string, errorName: string, message: string): TendDb {
  const db = new TendDb(name);
  db.open = () =>
    Dexie.Promise.reject(
      Object.assign(new Error(message), { name: errorName }),
    ) as PromiseExtended<Dexie>;
  return db;
}

/** What corruption looks like from here: it simply will not open. */
const unopenable = (name: string) => failingDb(name, 'UnknownError', 'disk I/O error');

function outboxRecord(seq: number, entityId: string): OutboxRecord {
  return {
    seq,
    mutationId: `m${seq}`,
    batchId: null,
    table: 'tasks',
    entityId,
    op: 'insert',
    patch: { id: entityId, title: `task ${seq}` },
    baseVersion: 0,
    deps: [],
    createdAt: 1_700_000_000_000 + seq,
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
  };
}

async function seedOutbox(records: OutboxRecord[]): Promise<void> {
  const db = new TendDb(dbName);
  await db.open();
  await db.outbox.bulkPut(records);
  db.close();
}

beforeEach(() => {
  dbName = `tend_recovery_test_${Date.now()}_${counter++}`;
  localStorage.clear();
});

afterEach(async () => {
  await Dexie.delete(dbName);
});

describe('the happy path', () => {
  it('opens and says nothing happened', async () => {
    const outcome = await openWithRecovery(dbName, (name) => new TendDb(name));

    expect(outcome.kind).toBe('opened');
    if (outcome.kind !== 'opened') return;
    expect(outcome.db.isOpen()).toBe(true);
    outcome.db.close();
  });
});

describe('a database that will not open', () => {
  it('rebuilds it and carries the unsent mutations across', async () => {
    await seedOutbox([outboxRecord(1, 'a'), outboxRecord(2, 'b')]);

    let attempt = 0;
    const outcome = await openWithRecovery(dbName, (name) => {
      attempt += 1;
      // The first handle is the broken one. The ladder makes a second after
      // deleting, and that one has to work.
      return attempt === 1 ? unopenable(name) : new TendDb(name);
    });

    expect(outcome.kind).toBe('rebuilt');
    if (outcome.kind !== 'rebuilt') return;
    expect(outcome.rescued).toBe(2);

    const restored = await outcome.db.outbox.orderBy('seq').toArray();
    expect(restored.map((row) => row.entityId)).toEqual(['a', 'b']);
    // The original seq survives, so this device's ordering is unchanged and the
    // generator carries on past it rather than colliding.
    expect(restored.map((row) => row.seq)).toEqual([1, 2]);
    outcome.db.close();
  });

  it('rebuilds an empty one without complaining', async () => {
    let attempt = 0;
    const outcome = await openWithRecovery(dbName, (name) => {
      attempt += 1;
      return attempt === 1 ? unopenable(name) : new TendDb(name);
    });

    expect(outcome.kind).toBe('rebuilt');
    if (outcome.kind !== 'rebuilt') return;
    expect(outcome.rescued).toBe(0);
    outcome.db.close();
  });

  it('refuses to rebuild twice in an hour', async () => {
    await seedOutbox([outboxRecord(1, 'a')]);

    let attempt = 0;
    const brokenThenWorking = (name: string) =>
      ++attempt === 1 ? unopenable(name) : new TendDb(name);

    const first = await openWithRecovery(dbName, brokenThenWorking, 1_000_000);
    expect(first.kind).toBe('rebuilt');
    if (first.kind === 'rebuilt') first.db.close();

    // Ten minutes later, broken again. A second wipe would present as an app
    // that keeps forgetting, so the ladder stops and says so instead.
    const second = await openWithRecovery(
      dbName,
      unopenable,
      1_000_000 + 10 * 60 * 1000,
    );
    expect(second.kind).toBe('failed');
    if (second.kind !== 'failed') return;
    expect(second.message).toContain('disk I/O error');
    // The database it refused to touch is still there.
    expect(await Dexie.exists(dbName)).toBe(true);

    // Past the cooldown it is allowed to try again.
    attempt = 0;
    const third = await openWithRecovery(
      dbName,
      brokenThenWorking,
      1_000_000 + 61 * 60 * 1000,
    );
    expect(third.kind).toBe('rebuilt');
    if (third.kind === 'rebuilt') third.db.close();
  });
});

describe('data this code is too old to read', () => {
  it('opens a store a newer version of the app upgraded', async () => {
    // Dexie handles the ordinary form of this itself, and the reason it matters
    // here is negative: this must NOT reach the rebuild rung, because the store
    // is newer rather than broken and deleting it would destroy the good copy.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 99);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const outcome = await openWithRecovery(dbName, (name) => new TendDb(name));

    expect(outcome.kind).toBe('opened');
    if (outcome.kind === 'opened') outcome.db.close();
  });

  it('reports stale code rather than deleting a store it cannot read', async () => {
    await seedOutbox([outboxRecord(1, 'a')]);

    const outcome = await openWithRecovery(dbName, (name) =>
      failingDb(name, 'VersionError', 'the requested version is less than the existing one'),
    );

    expect(outcome.kind).toBe('stale_code');
    // The assertion that matters: the good copy survived.
    expect(await Dexie.exists(dbName)).toBe(true);
    const survivor = new TendDb(dbName);
    await survivor.open();
    expect(await survivor.outbox.count()).toBe(1);
    survivor.close();
  });
});

describe('a rebuild interrupted halfway', () => {
  it('restores the rescue left in localStorage on the next open', async () => {
    // What the ladder leaves behind if the tab dies between the delete and the
    // restore. The next open is the only chance to put it back.
    localStorage.setItem(
      'tend.recovery.outbox',
      JSON.stringify([outboxRecord(7, 'stranded')]),
    );

    const outcome = await openWithRecovery(dbName, (name) => new TendDb(name));

    expect(outcome.kind).toBe('opened');
    if (outcome.kind !== 'opened') return;
    const restored = await outcome.db.outbox.toArray();
    expect(restored.map((row) => row.entityId)).toEqual(['stranded']);
    // Taken, not left to be restored again on every load.
    expect(localStorage.getItem('tend.recovery.outbox')).toBeNull();
    outcome.db.close();
  });
});
