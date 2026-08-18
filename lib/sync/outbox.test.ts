import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { setDb, TendDb } from '@/lib/db/client';
import { createTask, updateTask } from '@/lib/db/mutations';
import type { OutboxRecord } from '@/lib/db/types';
import {
  ackBatch,
  claimBatch,
  coalesce,
  deadCount,
  failBatch,
  MAX_ATTEMPTS,
  pendingCount,
  reclaimStale,
  STALE_INFLIGHT_MS,
} from './outbox';

let db: TendDb;
let dbName: string;
let counter = 0;

beforeEach(async () => {
  dbName = `tend_outbox_${Date.now()}_${counter++}`;
  db = new TendDb(dbName);
  setDb(db);
  await db.open();
});

afterEach(async () => {
  db.close();
  setDb(null);
  await Dexie.delete(dbName);
});

function record(over: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    mutationId: `m${Math.random()}`,
    batchId: null,
    table: 'tasks',
    entityId: 'task-1',
    op: 'update',
    patch: { title: 'a' },
    baseVersion: 5,
    deps: [],
    createdAt: Date.now(),
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    ...over,
  };
}

describe('coalescing', () => {
  it('merges a run of updates to the same row', () => {
    // Editing four fields in the detail panel should cost one round trip.
    const merged = coalesce([
      record({ seq: 1, patch: { title: 'a' } }),
      record({ seq: 2, patch: { notes: 'b' } }),
      record({ seq: 3, patch: { priority: 2 } }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.patch).toEqual({ title: 'a', notes: 'b', priority: 2 });
    expect(merged[0]!.seq).toBe(3);
  });

  it('lets the later write win on the same field', () => {
    const merged = coalesce([
      record({ seq: 1, patch: { title: 'first' } }),
      record({ seq: 2, patch: { title: 'second' } }),
    ]);
    expect(merged[0]!.patch).toEqual({ title: 'second' });
  });

  it('refuses to merge across different base versions', () => {
    // The two edits were decided against different server state, so collapsing
    // them into one base would either resurrect a field the client already saw
    // superseded or drop one it legitimately overwrote.
    const merged = coalesce([
      record({ seq: 1, baseVersion: 5, patch: { title: 'a' } }),
      record({ seq: 2, baseVersion: 9, patch: { notes: 'b' } }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('never merges an update into a preceding insert', () => {
    // The insert applies as `on conflict do nothing`. If it already landed and
    // only the ack was lost, a merged record would be swallowed whole and the
    // edits inside it would vanish with nothing left to resend.
    const merged = coalesce([
      record({ seq: 1, op: 'insert', baseVersion: 0, patch: { id: 'task-1', title: 'a' } }),
      record({ seq: 2, op: 'update', baseVersion: 0, patch: { title: 'b' } }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('keeps deletes separate from the updates around them', () => {
    const merged = coalesce([
      record({ seq: 1, patch: { title: 'a' } }),
      record({ seq: 2, op: 'delete', patch: { deletedAt: 'now' } }),
      record({ seq: 3, patch: { title: 'b' } }),
    ]);
    expect(merged.map((r) => r.op)).toEqual(['update', 'delete', 'update']);
  });

  it('does not merge across two different rows', () => {
    const merged = coalesce([
      record({ seq: 1, entityId: 'task-1' }),
      record({ seq: 2, entityId: 'task-2' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('leaves a transactional batch alone', () => {
    // Records sharing a batchId have to reach the server as they were queued.
    const merged = coalesce([
      record({ seq: 1, batchId: 'b1' }),
      record({ seq: 2, batchId: 'b1' }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('claiming', () => {
  it('marks what it takes as inflight', async () => {
    const id = await createTask({ title: 'Buy oat milk' }, db);
    await updateTask(id, { title: 'Buy soy milk' }, db);

    const { seqs } = await claimBatch(db);
    expect(seqs).toHaveLength(2);

    const states = (await db.outbox.toArray()).map((r) => r.state);
    expect(states).toEqual(['inflight', 'inflight']);
  });

  it('skips records still waiting out a backoff', async () => {
    await db.outbox.add(record({ nextAttemptAt: Date.now() + 60_000 }));
    const { seqs } = await claimBatch(db);
    expect(seqs).toEqual([]);
  });

  it('takes a failed record once its backoff has elapsed', async () => {
    await db.outbox.add(record({ state: 'failed', nextAttemptAt: 1_000 }));
    const { seqs } = await claimBatch(db, 2_000);
    expect(seqs).toHaveLength(1);
  });

  it('leaves dead records where they are', async () => {
    await db.outbox.add(record({ state: 'dead' }));
    const { seqs } = await claimBatch(db);
    expect(seqs).toEqual([]);
  });

  it('reports every seq it covers, including ones coalescing merged away', async () => {
    // The caller settles by seq, so a merged-away record still has to be acked
    // or it sits in the queue forever.
    for (const patch of [{ title: 'a' }, { notes: 'b' }, { priority: 1 }]) {
      await db.outbox.add(record({ patch }));
    }
    const { records, seqs } = await claimBatch(db);
    expect(records).toHaveLength(1);
    expect(seqs).toHaveLength(3);
  });
});

describe('settling', () => {
  it('drops acked records', async () => {
    const id = await createTask({ title: 'Buy oat milk' }, db);
    expect(id).toBeTruthy();
    const { seqs } = await claimBatch(db);
    await ackBatch(db, seqs);
    expect(await db.outbox.count()).toBe(0);
  });

  it('returns a retryable failure to the queue with a growing delay', async () => {
    await db.outbox.add(record());
    const { seqs } = await claimBatch(db);

    const first = await failBatch(db, seqs, { kind: 'retryable', code: '500', message: 'x' }, 0);
    expect(first).toEqual({ retried: 1, dead: 0 });
    expect((await db.outbox.get(seqs[0]!))?.nextAttemptAt).toBe(1_000);

    await db.outbox.update(seqs[0]!, { state: 'pending' as const });
    await failBatch(db, seqs, { kind: 'retryable', code: '500', message: 'x' }, 0);
    expect((await db.outbox.get(seqs[0]!))?.nextAttemptAt).toBe(2_000);
  });

  it('retires a record the server will never accept', async () => {
    // A fatal failure is not worth eight attempts. It goes straight to the
    // deadletter, where it stays visible instead of vanishing.
    await db.outbox.add(record());
    const { seqs } = await claimBatch(db);
    const result = await failBatch(db, seqs, { kind: 'fatal', code: '22023', message: 'bad' });

    expect(result).toEqual({ retried: 0, dead: 1 });
    expect(await deadCount(db)).toBe(1);
    expect(await db.deadletter.count()).toBe(1);
  });

  it('retires a record that has failed too many times', async () => {
    await db.outbox.add(record({ attempts: MAX_ATTEMPTS - 1 }));
    const { seqs } = await claimBatch(db);
    const result = await failBatch(db, seqs, { kind: 'retryable', code: '500', message: 'x' });
    expect(result).toEqual({ retried: 0, dead: 1 });
  });

  it('keeps the reason on a retired record', async () => {
    await db.outbox.add(record());
    const { seqs } = await claimBatch(db);
    await failBatch(db, seqs, { kind: 'fatal', code: '42501', message: 'denied' });
    expect((await db.deadletter.toArray())[0]?.reason).toBe('42501: denied');
  });
});

describe('recovering from a tab that died mid-push', () => {
  it('returns stranded inflight records to the queue', async () => {
    // Without this the queue strands: the records sit inflight, the claim skips
    // them, and the UI cheerfully says synced while the work never leaves.
    await db.outbox.add(record({ createdAt: 0 }));
    const { seqs } = await claimBatch(db);
    expect((await db.outbox.get(seqs[0]!))?.state).toBe('inflight');

    const reclaimed = await reclaimStale(db, STALE_INFLIGHT_MS + 1);
    expect(reclaimed).toBe(1);
    expect((await db.outbox.get(seqs[0]!))?.state).toBe('pending');
  });

  it('leaves a request that is merely slow alone', async () => {
    await db.outbox.add(record({ createdAt: 0 }));
    await claimBatch(db);
    expect(await reclaimStale(db, STALE_INFLIGHT_MS - 1)).toBe(0);
  });
});

describe('counts', () => {
  it('counts everything not yet settled', async () => {
    await createTask({ title: 'a' }, db);
    await createTask({ title: 'b' }, db);
    expect(await pendingCount(db)).toBe(2);

    const { seqs } = await claimBatch(db);
    // Still unsettled while inflight, which is what the badge should show.
    expect(await pendingCount(db)).toBe(2);

    await ackBatch(db, seqs);
    expect(await pendingCount(db)).toBe(0);
  });
});
