import type { TendDb } from '@/lib/db/client';
import type { OutboxRecord } from '@/lib/db/types';
import { backoffDelay, type SyncFailure } from './errors';
import { MAX_BATCH_BYTES, MAX_BATCH_MUTATIONS } from './protocol';

/**
 * The queue of local mutations waiting to reach the server.
 *
 * `mutations.ts` fills it; this drains it. Everything here writes only
 * local-only tables, so none of it needs an outbox record of its own, which is
 * why the write-path lint rule names the synced tables rather than banning
 * `db.*` writes outright.
 *
 * The claim is deliberately not a transaction that spans the network. Records
 * are marked inflight, the request goes out, and the ack settles them. If the
 * tab dies in between they stay inflight, and `reclaimStale` puts them back.
 * Every mutation carries an idempotency key, so the worst case is one duplicate
 * request that the server answers from its mutation log.
 */

/** Past this many failures a record stops being retried and becomes visible. */
export const MAX_ATTEMPTS = 8;

/** Inflight for longer than this means the tab that claimed it is gone. */
export const STALE_INFLIGHT_MS = 60_000;

export async function pendingCount(db: TendDb): Promise<number> {
  return db.outbox.where('state').anyOf('pending', 'inflight', 'failed').count();
}

export async function deadCount(db: TendDb): Promise<number> {
  return db.outbox.where('state').equals('dead').count();
}

/**
 * Returns records that were claimed by a tab that never came back.
 *
 * Without this a crash during a push strands the queue forever: the records sit
 * inflight, the claim query skips them, and the user's work never leaves the
 * device while the UI cheerfully says "synced".
 */
export async function reclaimStale(db: TendDb, now = Date.now()): Promise<number> {
  const stale = await db.outbox
    .where('state')
    .equals('inflight')
    .filter((r) => now - r.createdAt > STALE_INFLIGHT_MS)
    .toArray();

  for (const record of stale) {
    await db.outbox.update(record.seq!, { state: 'pending' as const });
  }
  return stale.length;
}

/**
 * Merges runs of updates to the same row into one mutation.
 *
 * Editing four fields in the detail panel queues four records that the server
 * would apply one at a time. Coalescing them costs one round trip instead of
 * four.
 *
 * Only updates merge, and only when they share a baseVersion. Both limits are
 * load-bearing:
 *
 *   * baseVersion drives the server's per-field merge. Two updates taken from
 *     different reads of the row were decided against different server state,
 *     and collapsing them into one base would either resurrect a field the
 *     client already saw superseded or drop one it legitimately overwrote.
 *
 *   * An update is never merged into a preceding insert. The insert applies as
 *     `on conflict (id) do nothing`, so if it already landed and only the ack
 *     was lost, a merged record would be swallowed whole and the edits inside
 *     it would vanish with nothing left to resend.
 */
export function coalesce(records: OutboxRecord[]): OutboxRecord[] {
  const out: OutboxRecord[] = [];

  for (const record of records) {
    const previous = out[out.length - 1];
    const mergeable =
      previous !== undefined &&
      previous.op === 'update' &&
      record.op === 'update' &&
      previous.table === record.table &&
      previous.entityId === record.entityId &&
      previous.baseVersion === record.baseVersion &&
      previous.batchId === null &&
      record.batchId === null;

    if (mergeable) {
      // Later wins per field, which matches the order they were applied
      // locally. The merged record keeps the newer mutationId so the ack still
      // settles something the server has an answer for.
      out[out.length - 1] = {
        ...previous,
        mutationId: record.mutationId,
        patch: { ...previous.patch, ...record.patch },
        // Both seqs are dropped from the queue on ack, so the merged record
        // carries the later one and the caller settles the range.
        seq: record.seq,
      };
      continue;
    }

    out.push(record);
  }

  return out;
}

export interface ClaimedBatch {
  records: OutboxRecord[];
  /** Every seq the batch covers, including ones merged away by coalescing. */
  seqs: number[];
}

/**
 * Takes the next batch and marks it inflight.
 *
 * Bounded three ways: by count, by serialized size, and by batch boundary. The
 * last one matters most. Mutations sharing a batchId have to reach the server
 * in one transaction, because a subtask created offline under an offline
 * project commits atomically or not at all, so a batch is never split across
 * two requests.
 */
export async function claimBatch(db: TendDb, now = Date.now()): Promise<ClaimedBatch> {
  const ready = await db.outbox
    .where('state')
    .anyOf('pending', 'failed')
    .filter((r) => r.nextAttemptAt <= now)
    .sortBy('seq');

  const taken: OutboxRecord[] = [];
  const seqs: number[] = [];
  let bytes = 0;

  for (const record of ready) {
    const size = JSON.stringify(record.patch).length;

    if (taken.length >= MAX_BATCH_MUTATIONS || bytes + size > MAX_BATCH_BYTES) {
      // Never cut a transactional batch in half. Stopping short here leaves the
      // whole group for the next round trip.
      if (record.batchId !== null && taken.some((t) => t.batchId === record.batchId)) {
        while (taken.length > 0 && taken[taken.length - 1]!.batchId === record.batchId) {
          const dropped = taken.pop()!;
          seqs.pop();
          bytes -= JSON.stringify(dropped.patch).length;
        }
      }
      break;
    }

    taken.push(record);
    seqs.push(record.seq!);
    bytes += size;
  }

  for (const seq of seqs) {
    await db.outbox.update(seq, { state: 'inflight' as const });
  }

  return { records: coalesce(taken), seqs };
}

/** Drops the records the server confirmed. */
export async function ackBatch(db: TendDb, seqs: number[]): Promise<void> {
  await db.outbox.bulkDelete(seqs);
}

/**
 * Returns a failed batch to the queue, or retires it.
 *
 * A record past MAX_ATTEMPTS moves to the deadletter table rather than being
 * deleted. Work that cannot be sent is worth surfacing; work that silently
 * disappears is how an offline app loses data without anybody noticing.
 */
export async function failBatch(
  db: TendDb,
  seqs: number[],
  failure: SyncFailure,
  now = Date.now(),
): Promise<{ retried: number; dead: number }> {
  let retried = 0;
  let dead = 0;

  for (const seq of seqs) {
    const record = await db.outbox.get(seq);
    if (!record) continue;

    const attempts = record.attempts + 1;
    const lastError = {
      code: failure.code,
      message: failure.message,
      at: now,
      ...(failure.status !== undefined ? { status: failure.status } : {}),
    };

    if (failure.kind === 'fatal' || attempts >= MAX_ATTEMPTS) {
      await db.deadletter.put({
        mutationId: record.mutationId,
        table: record.table,
        entityId: record.entityId,
        createdAt: record.createdAt,
        reason: `${failure.code}: ${failure.message}`,
      });
      await db.outbox.update(seq, { state: 'dead' as const, attempts, lastError });
      dead += 1;
      continue;
    }

    await db.outbox.update(seq, {
      state: 'pending' as const,
      attempts,
      nextAttemptAt: now + backoffDelay(attempts),
      lastError,
    });
    retried += 1;
  }

  return { retried, dead };
}

/** Records a per-field merge the server resolved against this client. */
export async function noteConflict(
  db: TendDb,
  table: string,
  entityId: string,
  droppedFields: string[],
  now = Date.now(),
): Promise<void> {
  if (droppedFields.length === 0) return;
  await db.conflicts.add({ table, entityId, at: now, droppedFields });
}

/**
 * Puts retired work back in the queue.
 *
 * Records reach the deadletter when the server refused them enough times, and
 * the usual cause is a server-side bug rather than anything wrong with the
 * mutation. Once that bug is fixed the work is still perfectly good, and
 * without this it would sit there forever.
 *
 * Safe to call twice. Every record still carries its original mutationId, so a
 * mutation that actually did apply before the ack was lost comes back from the
 * server's log rather than applying a second time.
 */
export async function requeueDead(db: TendDb): Promise<number> {
  const dead = await db.outbox.where('state').equals('dead').toArray();

  for (const record of dead) {
    await db.outbox.update(record.seq!, {
      state: 'pending' as const,
      attempts: 0,
      nextAttemptAt: 0,
    });
    await db.deadletter.delete(record.mutationId);
  }

  return dead.length;
}
