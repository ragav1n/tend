import Dexie from 'dexie';
import type { TendDb } from './client';
import type { OutboxRecord } from './types';

/**
 * What to do when IndexedDB will not open.
 *
 * It happens. A disk error, a half-finished upgrade, a browser bug, a profile
 * copied between machines. Without a ladder the app is a blank screen with a
 * console error, which for a local-first app means every task the person owns is
 * unreachable and there is nothing they can do about it.
 *
 * The ladder, in order, because each rung costs more than the one above:
 *
 *   1. **Open it again.** A surprising share of failures are transient. Only an
 *      outright rejection counts as a failure here: an open that is merely slow
 *      answers `stalled` and stops, because the next rung deletes things.
 *   2. **Refuse to touch data the code is too old to understand.** A `VersionError`
 *      means the store on disk is newer than this bundle, which is not corruption
 *      and must never be answered by deleting it. Dexie handles the ordinary form
 *      of this itself: it retries at whatever version is on disk and patches in
 *      the stores its schema declares, so an old tab can read a store a newer tab
 *      upgraded. This rung is for when that retry fails too, and then the fix is a
 *      reload rather than a rebuild.
 *   3. **Rescue the outbox, delete, rebuild.** Unsent mutations are the only rows
 *      that exist nowhere else, so they are copied out before the database goes,
 *      and copied back into the fresh one.
 *
 * The rescue is worth more than it looks. An insert record carries the whole row
 * and a patch carries the changed fields, so a rebuilt database that pushes its
 * rescued outbox gets the server to reconstruct what was lost, and the next pull
 * brings it home. Even for somebody who has never signed in, the queue is the
 * whole history of their writes, so signing in after a rebuild recovers the data
 * rather than just the last few edits.
 *
 * A rebuild is destructive and runs at most once an hour. A loop that wipes the
 * database on every load would present as an app that keeps forgetting, which is
 * worse than an app that says it is broken.
 */

/** Long enough that a reopen loop cannot wipe the database twice. */
const REBUILD_COOLDOWN_MS = 60 * 60 * 1000;
const LAST_REBUILD_KEY = 'tend.recovery.lastRebuild';

/**
 * Where rescued records wait while the database is deleted and remade. On disk
 * rather than in memory, because if the tab dies in that window the only copy of
 * that work would go with it.
 */
const RESCUE_KEY = 'tend.recovery.outbox';

/** localStorage is a few megabytes across the whole origin. Do not fill it. */
const RESCUE_MAX_BYTES = 2_000_000;

/**
 * An upgrade blocked by another tab never rejects, it just never resolves, so the
 * only way to notice is to stop waiting. Long enough that a slow device is not
 * mistaken for a stuck one, and a stall is never treated as corruption anyway.
 */
const OPEN_TIMEOUT_MS = 10_000;

export type OpenOutcome =
  | { kind: 'opened'; db: TendDb }
  /** Rebuilt from empty. `rescued` unsent mutations came across. */
  | { kind: 'rebuilt'; db: TendDb; rescued: number }
  /** Another tab holds an older version open. Closing it is the fix. */
  | { kind: 'blocked' }
  /**
   * It neither opened nor failed inside the timeout. Nothing is deleted for this:
   * a slow phone, a big upgrade or a frozen background tab all look like this from
   * here, and none of them is a reason to throw somebody's data away.
   */
  | { kind: 'stalled' }
  /** The stored data is newer than this code. Reloading is the fix. */
  | { kind: 'stale_code' }
  | { kind: 'failed'; message: string };

/**
 * localStorage, or nothing.
 *
 * Every read and write here is on a failure path, and a failure path that throws
 * because storage is disabled or full turns a recoverable database into an
 * unrecoverable one. Safari in private mode used to throw on `setItem` outright.
 */
function recall(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing depends on this succeeding.
  }
}

/** Dexie surfaces this only after its own open-at-the-stored-version retry fails. */
function isVersionError(error: unknown): boolean {
  return error instanceof Error && error.name === 'VersionError';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Opens, and reports a stall rather than hanging on it.
 *
 * Dexie surfaces a blocked upgrade as an event and leaves the promise pending
 * forever, so the timeout is the only way to notice one.
 *
 * A stall is its own answer and never an exception, which is the whole point of
 * this signature. Throwing here would send it to the caller's catch, where the
 * next rung is deleting the database, and "took more than ten seconds" is not
 * evidence of corruption: a large upgrade on a slow phone reads exactly like this,
 * and so does a background tab the browser froze.
 */
async function openOrStall(
  db: TendDb,
  timeoutMs: number,
): Promise<'ok' | 'blocked' | 'stalled'> {
  let blocked = false;
  const noteBlocked = () => {
    blocked = true;
  };
  db.on('blocked', noteBlocked);

  try {
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), timeoutMs),
    );
    const result = await Promise.race([db.open().then(() => 'ok' as const), timeout]);
    if (result === 'ok') return 'ok';
    return blocked ? 'blocked' : 'stalled';
  } finally {
    db.on('blocked').unsubscribe(noteBlocked);
  }
}

/**
 * Reads the outbox out of a database Dexie cannot open.
 *
 * Raw IndexedDB with no version argument, so it opens whatever version is on
 * disk and never triggers an upgrade. Dexie's own open is what failed, so asking
 * it again through a different door is the point.
 */
function rescueOutbox(name: string): Promise<OutboxRecord[]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (records: OutboxRecord[]) => {
      if (settled) return;
      settled = true;
      resolve(records);
    };

    // A database this broken can also hang. Nothing to rescue is a valid answer.
    setTimeout(() => finish([]), OPEN_TIMEOUT_MS);

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name);
    } catch {
      finish([]);
      return;
    }

    request.onerror = () => finish([]);
    request.onblocked = () => finish([]);
    request.onupgradeneeded = () => {
      // No version was asked for, so this only fires when the database does not
      // exist. There is nothing in it to save.
      request.transaction?.abort();
      finish([]);
    };
    request.onsuccess = () => {
      const raw = request.result;
      try {
        if (!raw.objectStoreNames.contains('outbox')) {
          raw.close();
          finish([]);
          return;
        }
        const read = raw.transaction('outbox', 'readonly').objectStore('outbox').getAll();
        read.onsuccess = () => {
          raw.close();
          finish((read.result ?? []) as OutboxRecord[]);
        };
        read.onerror = () => {
          raw.close();
          finish([]);
        };
      } catch {
        raw.close();
        finish([]);
      }
    };
  });
}

function stashRescue(records: OutboxRecord[]): void {
  if (records.length === 0) return;
  const json = JSON.stringify(records);
  // Out of room here too. The in-memory copy is still restored below; only the
  // protection against the tab dying mid-rebuild is given up.
  if (json.length > RESCUE_MAX_BYTES) return;
  remember(RESCUE_KEY, json);
}

function takeStashedRescue(): OutboxRecord[] {
  const json = recall(RESCUE_KEY);
  remember(RESCUE_KEY, null);
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as OutboxRecord[]) : [];
  } catch {
    return [];
  }
}

function rebuiltRecently(now: number): boolean {
  const last = Number(recall(LAST_REBUILD_KEY) ?? '0');
  return Number.isFinite(last) && last > 0 && now - last < REBUILD_COOLDOWN_MS;
}

/**
 * Puts rescued mutations back. `seq` is an auto-increment key and the records
 * carry theirs, so `bulkPut` keeps this device's original ordering and the
 * generator continues past the highest one.
 */
async function restore(db: TendDb, records: OutboxRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  try {
    await db.outbox.bulkPut(records);
    return records.length;
  } catch {
    // Better an empty queue in a working database than no database.
    return 0;
  }
}

/**
 * The ladder. `client.ts` calls this instead of `open()`.
 *
 * `make`, `now` and `timeoutMs` are seams for the tests, which have to induce an
 * unopenable database, reason about the rebuild cooldown without waiting an hour,
 * and see a stall without waiting ten seconds for one.
 */
export async function openWithRecovery(
  name: string,
  make: (name: string) => TendDb,
  now: number = Date.now(),
  timeoutMs: number = OPEN_TIMEOUT_MS,
): Promise<OpenOutcome> {
  const db = make(name);

  try {
    const first = await openOrStall(db, timeoutMs);
    if (first !== 'ok') return { kind: first === 'blocked' ? 'blocked' : 'stalled' };

    // A rebuild that was interrupted between the delete and the restore left its
    // rescue behind. This is the only chance to put it back.
    const leftover = takeStashedRescue();
    if (leftover.length > 0) await restore(db, leftover);

    return { kind: 'opened', db };
  } catch (error) {
    db.close();

    if (isVersionError(error)) return { kind: 'stale_code' };
    if (rebuiltRecently(now)) return { kind: 'failed', message: messageOf(error) };

    const rescued = await rescueOutbox(name);
    stashRescue(rescued);

    try {
      await Dexie.delete(name);
    } catch (deleteError) {
      return { kind: 'failed', message: messageOf(deleteError) };
    }

    remember(LAST_REBUILD_KEY, String(now));

    const fresh = make(name);
    try {
      const second = await openOrStall(fresh, timeoutMs);
      if (second !== 'ok') return { kind: second === 'blocked' ? 'blocked' : 'stalled' };
    } catch (reopenError) {
      fresh.close();
      return { kind: 'failed', message: messageOf(reopenError) };
    }

    const restored = await restore(fresh, rescued);
    remember(RESCUE_KEY, null);
    return { kind: 'rebuilt', db: fresh, rescued: restored };
  }
}
