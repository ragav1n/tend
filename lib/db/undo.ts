import { getDb, type TendDb } from './client';
import { revertActivity } from './mutations';
import type { ActivityEntry } from './types';

/**
 * The undo stack, which is the activity log read backwards.
 *
 * There is no separate stack in memory, so undo survives a reload and works on
 * whichever device is in front of you. That is the whole reason the log is a
 * synced table rather than a session variable.
 *
 * No redo. Undo marks a group taken back rather than pushing an inverse, so
 * there is nothing sitting on a second stack, and adding one would mean deciding
 * what happens to a redo whose task has since been edited on a phone. Not worth
 * it for a task app.
 */

/** The entries of the newest gesture that still stands, or none. */
export async function nextUndoGroup(db: TendDb = getDb()): Promise<ActivityEntry[]> {
  const newest = await db.activityLog
    .where('[_del+_undone+createdAt]')
    .between([0, 0, ''], [0, 0, '￿'], true, true)
    .reverse()
    .first();
  if (!newest) return [];

  return db.activityLog
    .where('groupId')
    .equals(newest.groupId)
    .filter((entry) => entry._del === 0 && entry._undone === 0)
    .toArray();
}

/** What a toast should say about a group. */
export function describeGroup(entries: readonly ActivityEntry[]): string {
  if (entries.length === 0) return 'Nothing to undo';
  if (entries.length === 1) return entries[0]!.summary;
  return `${entries.length} changes`;
}

/**
 * Take back the newest gesture. Returns what it took back, so the caller can
 * say so, or null when the log is empty.
 */
export async function undoLast(db: TendDb = getDb()): Promise<string | null> {
  const group = await nextUndoGroup(db);
  if (group.length === 0) return null;

  const description = describeGroup(group);
  await revertActivity(group, db);
  return description;
}
