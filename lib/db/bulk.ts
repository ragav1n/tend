import { completeTask, deleteTask, restoreTask, updateTask, type TaskPatch } from './mutations';

/**
 * The same mutations, applied to a handful of tasks.
 *
 * Sequential rather than `Promise.all`: each of these opens a Dexie readwrite
 * transaction, and firing twenty at once against one IndexedDB connection buys
 * nothing but contention on a store the UI is reading from.
 *
 * Each task still gets its own outbox record. That is the point rather than a
 * compromise: a bulk edit that failed as one unit would strand nineteen good
 * writes behind one bad row, which is exactly the failure `0017` was written to
 * stop.
 */

export async function completeMany(ids: readonly string[], done = true): Promise<void> {
  // completeTask rather than a status patch, so a recurring task in the
  // selection still materializes its next occurrence.
  for (const id of ids) await completeTask(id, done);
}

export async function patchMany(ids: readonly string[], patch: TaskPatch): Promise<void> {
  for (const id of ids) await updateTask(id, patch);
}

export async function deleteMany(ids: readonly string[]): Promise<void> {
  for (const id of ids) await deleteTask(id);
}

export async function restoreMany(ids: readonly string[]): Promise<void> {
  for (const id of ids) await restoreTask(id);
}
