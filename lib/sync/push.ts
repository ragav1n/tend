import type { TendDb } from '@/lib/db/client';
import type { OutboxRecord } from '@/lib/db/types';
import { discardLocal } from './apply';
import { localToWire } from './mapping';
import { ackBatch, claimBatch, failBatch, noteConflict } from './outbox';
import { WIRE_TABLE, type PushMutation, type PushResponse } from './protocol';
import { postJson, SyncError } from './transport';

/**
 * Sends one batch of queued mutations.
 *
 * Returns the server's cursor so the pull that follows can start from the right
 * place, and a flag saying whether more work is waiting, so a large offline
 * backlog drains in consecutive batches rather than one per trigger.
 */

export interface PushOutcome {
  cursor: number;
  /** Mutations were sent. False means the queue was empty. */
  sent: boolean;
  /** More records are ready, so the caller should push again. */
  hasMore: boolean;
  merged: number;
  /** Local rows dropped because another device created the same row first. */
  discarded: number;
}

/**
 * task_tags entities are keyed locally by `taskId:tagId`, which is not a uuid.
 * The RPC casts entityId to uuid, so the join row sends its task id there and
 * carries both ids in the patch, which is where the RPC reads them from anyway.
 */
function wireEntityId(record: OutboxRecord): string {
  if (record.table !== 'taskTags') return record.entityId;
  return String(record.patch.taskId ?? record.entityId.split(':')[0] ?? '');
}

function toMutation(record: OutboxRecord): PushMutation {
  const table = WIRE_TABLE[record.table];
  return {
    mutationId: record.mutationId,
    table,
    entityId: wireEntityId(record),
    op: record.op,
    patch: localToWire(table, record.patch),
    baseVersion: record.baseVersion,
  };
}

export async function pushOnce(db: TendDb): Promise<PushOutcome> {
  const { records, seqs } = await claimBatch(db);

  if (records.length === 0) {
    return { cursor: 0, sent: false, hasMore: false, merged: 0, discarded: 0 };
  }

  let response: PushResponse;
  try {
    response = await postJson<PushResponse>('/api/sync/push', {
      mutations: records.map(toMutation),
    });
  } catch (error) {
    const failure = error instanceof SyncError ? error.failure : undefined;
    if (failure) {
      // The whole claimed range is settled, not just the records that were
      // coalesced into the request. Anything left inflight would strand.
      await failBatch(db, seqs, failure);
    }
    throw error;
  }

  let merged = 0;
  let discarded = 0;

  for (const result of response.results) {
    // The local entityId, not the one that went out. task_tags sends its task id
    // on the wire and is keyed locally by `taskId:tagId`.
    const record = records.find((r) => r.mutationId === result.mutationId);

    if (result.status === 'merged' && result.droppedFields?.length) {
      // Recorded rather than surfaced. The default is silence: the merge
      // already did the right thing, and a toast saying "2 of your changes were
      // replaced" is alarming for something the user cannot act on.
      if (record) await noteConflict(db, record.table, record.entityId, result.droppedFields);
      merged += 1;
      continue;
    }

    // Another device created this row first. Taking the server's copy means
    // dropping the local one, or this device shows it twice from here on.
    const lostTheRace =
      result.status === 'superseded' ||
      // A join row whose tag lost that race. The task carries the whole tag set
      // on every pull, so the local row is the only thing left to clean up.
      (result.status === 'missing' && record?.table === 'taskTags' && record.op === 'insert');

    if (lostTheRace && record) {
      await discardLocal(db, record.table, record.entityId);
      discarded += 1;
    }
  }

  await ackBatch(db, seqs);

  // A full batch probably means more is waiting. Asking the queue directly
  // would be a second read for an answer the batch size already implies.
  const remaining = await claimBatch(db, 0);
  const hasMore = remaining.seqs.length > 0;
  // That probe marked records inflight, so put them back before returning.
  for (const seq of remaining.seqs) {
    await db.outbox.update(seq, { state: 'pending' as const });
  }

  return { cursor: response.cursor, sent: true, hasMore, merged, discarded };
}
