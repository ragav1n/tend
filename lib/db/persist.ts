import type { TendDb } from './client';

/**
 * Keeping the local store from being thrown away, and coping when it fills up.
 *
 * IndexedDB is evictable by default. A browser under disk pressure can clear a
 * whole origin without asking, and for this app that is not a cache miss: an
 * outbox that has not drained yet is the only copy of that work. So the app asks
 * for persistent storage, which moves it out of the evictable bucket.
 *
 * Nobody prompts for it except Firefox. Chrome grants it silently once the site
 * is installed or has enough engagement, Safari grants it to an installed app.
 * That is why the install prompt and this file are the same piece of work.
 */

export type PersistenceOutcome =
  /** Safe from eviction. */
  | 'granted'
  /** Asked and refused, or the browser has its own rules and said no. */
  | 'denied'
  | 'unsupported';

/** Remembers that the question was put, so Firefox is not asked twice. */
const ASKED_KEY = 'tend.persist.asked';

/**
 * Asking is a side quest, and it runs on the path that opens the database. A
 * throw here would surface as an unhandled rejection on every boot in a browser
 * with storage disabled, which is the one place this least deserves attention.
 */
function asked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

function noteAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Then it gets asked again next time, which is the harmless direction.
  }
}

/** Read-only, so settings can report the state without provoking a prompt. */
export async function isPersisted(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null;
  return navigator.storage.persisted();
}

export async function requestPersistence(): Promise<PersistenceOutcome> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'unsupported';

  // Cheap and silent, and it is also how a later automatic grant is noticed: a
  // browser that said no before will say yes on its own once the app is
  // installed, and this sees that without prompting again.
  if (await navigator.storage.persisted()) return 'granted';

  if (asked()) return 'denied';
  noteAsked();

  return (await navigator.storage.persist()) ? 'granted' : 'denied';
}

export interface StorageReport {
  usage: number;
  quota: number;
  /** 0 to 1. NaN quotas are reported as 0 rather than propagating. */
  ratio: number;
}

export async function storageReport(): Promise<StorageReport | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota, ratio: quota > 0 ? usage / quota : 0 };
}

/**
 * How many conflict records to keep. They exist so the UI can say "2 changes
 * from another device replaced yours", which nothing older than the last few
 * dozen is ever going to be used for.
 */
export const CONFLICT_LOG_CAP = 50;

/**
 * Free space after a quota failure, and report how much was actually freed.
 *
 * This is what gives `paused_quota` an exit. Without it the sync engine parks
 * there and never leaves, because nothing else in the app ever deletes anything.
 *
 * Only the two local-only logs are touched, and that limit is the point. The
 * volume in this database is tasks, and tasks are what the person came for. A
 * pruner that deleted completed tasks would free real space and would also put
 * silent holes in the Logbook that no later pull refills, since the cursor has
 * already moved past them. So when trimming the logs frees nothing, this returns
 * 0, the engine stays paused, and the badge says storage is full. Saying so is
 * better than quietly deleting somebody's records to keep a green tick.
 *
 * The deadletter is never touched at all. Those are mutations the server refused,
 * which is work that has not landed anywhere, and the badge exists to surface
 * them.
 */
export async function relieveQuota(db: TendDb): Promise<number> {
  let freed = 0;

  const conflicts = await db.conflicts.count();
  if (conflicts > CONFLICT_LOG_CAP) {
    const doomed = await db.conflicts
      .orderBy('at')
      .limit(conflicts - CONFLICT_LOG_CAP)
      .primaryKeys();
    await db.conflicts.bulkDelete(doomed);
    freed += doomed.length;
  }

  // Reminders whose task is gone. A local-only table with no tombstones, so
  // nothing else ever collects these.
  const reminders = await db.reminderState.toArray();
  if (reminders.length > 0) {
    const taskIds = reminders.map((row) => row.taskId);
    const tasks = await db.tasks.bulkGet(taskIds);
    const orphans = taskIds.filter((_, index) => tasks[index] === undefined);
    if (orphans.length > 0) {
      await db.reminderState.bulkDelete(orphans);
      freed += orphans.length;
    }
  }

  return freed;
}
