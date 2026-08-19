import type { TendDb } from '@/lib/db/client';
import {
  deriveActivity,
  deriveFocusSession,
  deriveProject,
  deriveSavedView,
  deriveSeries,
  deriveTag,
  deriveTask,
} from '@/lib/db/derive';
import { DEFAULT_PREFS, PREFS_ID } from '@/lib/db/prefs';
import type {
  ActivityEntry,
  EntityTable,
  FocusSession,
  Prefs,
  Project,
  SavedView,
  Tag,
  Task,
  TaskSeries,
} from '@/lib/db/types';
import { LOCAL_TABLE, type PullRow, type WireTable } from './protocol';
import { tagIdsOf, wireToLocal } from './mapping';

/**
 * Writes canonical server rows into the local store.
 *
 * This is the one file besides `mutations.ts` allowed to touch Dexie's synced
 * tables directly, and the reason is precise: applying a row that came *from*
 * the server must not generate an outbox record. Routing these through the
 * write API would queue every pulled row straight back at the server, and the
 * two would ping-pong forever.
 *
 * Two properties hold here and both are load-bearing:
 *
 *   * **Idempotent.** Applying the same page twice leaves the same state.
 *     Pages get re-applied after a lost ack more often than anyone expects.
 *
 *   * **Yields between chunks.** A first hydrate can be thousands of rows, and
 *     doing it in one transaction blocks the main thread long enough to drop
 *     frames on whatever the user is looking at.
 *
 * Derived fields are recomputed here through `derive.ts` rather than trusted
 * from the wire, which is what stops the optimistic path and this path from
 * disagreeing about what is in Today.
 */

/** Rows per transaction. Small enough to keep a frame, large enough to be fast. */
export const CHUNK_SIZE = 500;

export interface ApplyResult {
  applied: number;
  /** Rows skipped because the local copy was already at or ahead of them. */
  skipped: number;
}

/** Lets the browser paint between chunks instead of holding the main thread. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * True when the incoming row is not newer than what is already stored.
 *
 * The comparison is on row_version, never on updated_at. A local row with
 * version 0 has only ever existed on this device, so anything from the server
 * is newer by definition.
 */
function isStale(incoming: number, local: number | undefined): boolean {
  return local !== undefined && local > 0 && incoming <= local;
}

async function applyTasks(db: TendDb, rows: PullRow[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };

  await db.transaction('rw', [db.tasks, db.taskTags], async () => {
    const ids = rows.map((r) => String(r.row.id));
    const existing = await db.tasks.bulkGet(ids);
    const current = new Map(existing.filter((t): t is Task => t !== undefined).map((t) => [t.id, t]));

    const puts: Task[] = [];

    for (const { row } of rows) {
      const id = String(row.id);
      const incoming = Number(row.row_version ?? 0);
      if (isStale(incoming, current.get(id)?.rowVersion)) {
        result.skipped += 1;
        continue;
      }

      // Merged over whatever is stored rather than replacing it, so a column
      // this client is too old to know about survives the round trip instead of
      // being dropped on the floor.
      const base = { ...(current.get(id) ?? {}), ...wireToLocal('tasks', row) } as Task;
      const tagIds = tagIdsOf(row);

      if (tagIds !== null) {
        // The server sends the complete set, so it replaces rather than merges.
        // A partial application here is what leaves a task wearing a tag it was
        // untagged from on another device.
        await db.taskTags.where('taskId').equals(id).delete();
        for (const tagId of tagIds) {
          await db.taskTags.add({
            taskId: id,
            tagId,
            userId: base.userId,
            createdAt: base.createdAt,
            rowVersion: 0,
          });
        }
      }

      const resolved = tagIds ?? (current.get(id)?._tagIds ?? []);
      puts.push({ ...base, ...deriveTask(base, resolved) });
      result.applied += 1;
    }

    if (puts.length > 0) await db.tasks.bulkPut(puts);
  });

  return result;
}

async function applyProjects(db: TendDb, rows: PullRow[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };
  const ids = rows.map((r) => String(r.row.id));
  const current = new Map(
    (await db.projects.bulkGet(ids))
      .filter((p): p is Project => p !== undefined)
      .map((p) => [p.id, p]),
  );

  const puts: Project[] = [];
  for (const { row } of rows) {
    const id = String(row.id);
    if (isStale(Number(row.row_version ?? 0), current.get(id)?.rowVersion)) {
      result.skipped += 1;
      continue;
    }
    const base = { ...(current.get(id) ?? {}), ...wireToLocal('projects', row) } as Project;
    puts.push({ ...base, ...deriveProject(base) });
    result.applied += 1;
  }

  if (puts.length > 0) await db.projects.bulkPut(puts);
  return result;
}

async function applyTags(db: TendDb, rows: PullRow[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };
  const ids = rows.map((r) => String(r.row.id));
  const current = new Map(
    (await db.tags.bulkGet(ids)).filter((t): t is Tag => t !== undefined).map((t) => [t.id, t]),
  );

  const puts: Tag[] = [];
  for (const { row } of rows) {
    const id = String(row.id);
    if (isStale(Number(row.row_version ?? 0), current.get(id)?.rowVersion)) {
      result.skipped += 1;
      continue;
    }
    const base = { ...(current.get(id) ?? {}), ...wireToLocal('tags', row) } as Tag;
    puts.push({ ...base, ...deriveTag(base) });
    result.applied += 1;
  }

  if (puts.length > 0) await db.tags.bulkPut(puts);
  return result;
}

async function applySeries(db: TendDb, rows: PullRow[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };
  const ids = rows.map((r) => String(r.row.id));
  const current = new Map(
    (await db.taskSeries.bulkGet(ids))
      .filter((s): s is TaskSeries => s !== undefined)
      .map((s) => [s.id, s]),
  );

  const puts: TaskSeries[] = [];
  for (const { row } of rows) {
    const id = String(row.id);
    if (isStale(Number(row.row_version ?? 0), current.get(id)?.rowVersion)) {
      result.skipped += 1;
      continue;
    }
    const base = { ...(current.get(id) ?? {}), ...wireToLocal('task_series', row) } as TaskSeries;
    puts.push({ ...base, ...deriveSeries(base) });
    result.applied += 1;
  }

  if (puts.length > 0) await db.taskSeries.bulkPut(puts);
  return result;
}

async function applyFocusSessions(db: TendDb, rows: PullRow[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };
  const ids = rows.map((r) => String(r.row.id));
  const current = new Map(
    (await db.focusSessions.bulkGet(ids))
      .filter((f): f is FocusSession => f !== undefined)
      .map((f) => [f.id, f]),
  );

  const puts: FocusSession[] = [];
  for (const { row } of rows) {
    const id = String(row.id);
    if (isStale(Number(row.row_version ?? 0), current.get(id)?.rowVersion)) {
      result.skipped += 1;
      continue;
    }
    const base = {
      ...(current.get(id) ?? {}),
      ...wireToLocal('focus_sessions', row),
    } as FocusSession;
    puts.push({ ...base, ...deriveFocusSession(base) });
    result.applied += 1;
  }

  if (puts.length > 0) await db.focusSessions.bulkPut(puts);
  return result;
}

/**
 * Settings, which are one row with no id on the wire.
 *
 * The server keys it by user_id and strips that column on the way out, so the
 * local key is a constant and the incoming row is merged over whatever this
 * device already believes. Nothing here is derived: there is no index on it.
 */
async function applyPrefs(db: TendDb, rows: PullRow[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };
  const current = await db.prefs.get(PREFS_ID);

  for (const { row } of rows) {
    if (isStale(Number(row.row_version ?? 0), current?.rowVersion)) {
      result.skipped += 1;
      continue;
    }
    const merged = {
      ...(current ?? DEFAULT_PREFS),
      ...wireToLocal('user_settings', row),
      id: PREFS_ID,
    } as Prefs;
    await db.prefs.put(merged);
    result.applied += 1;
  }

  return result;
}

async function applyActivity(db: TendDb, rows: PullRow[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };
  const ids = rows.map((r) => String(r.row.id));
  const current = new Map(
    (await db.activityLog.bulkGet(ids))
      .filter((entry): entry is ActivityEntry => entry !== undefined)
      .map((entry) => [entry.id, entry]),
  );

  const puts: ActivityEntry[] = [];
  for (const { row } of rows) {
    const id = String(row.id);
    if (isStale(Number(row.row_version ?? 0), current.get(id)?.rowVersion)) {
      result.skipped += 1;
      continue;
    }
    const base = {
      ...(current.get(id) ?? {}),
      ...wireToLocal('activity_log', row),
    } as ActivityEntry;
    puts.push({ ...base, ...deriveActivity(base) });
    result.applied += 1;
  }

  if (puts.length > 0) await db.activityLog.bulkPut(puts);
  return result;
}

async function applySavedViews(db: TendDb, rows: PullRow[]): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };
  const ids = rows.map((r) => String(r.row.id));
  const current = new Map(
    (await db.savedViews.bulkGet(ids))
      .filter((view): view is SavedView => view !== undefined)
      .map((view) => [view.id, view]),
  );

  const puts: SavedView[] = [];
  for (const { row } of rows) {
    const id = String(row.id);
    if (isStale(Number(row.row_version ?? 0), current.get(id)?.rowVersion)) {
      result.skipped += 1;
      continue;
    }
    const base = { ...(current.get(id) ?? {}), ...wireToLocal('saved_views', row) } as SavedView;
    puts.push({ ...base, ...deriveSavedView(base) });
    result.applied += 1;
  }

  if (puts.length > 0) await db.savedViews.bulkPut(puts);
  return result;
}

const APPLIERS: Partial<
  Record<WireTable, (db: TendDb, rows: PullRow[]) => Promise<ApplyResult>>
> = {
  tasks: applyTasks,
  projects: applyProjects,
  tags: applyTags,
  task_series: applySeries,
  focus_sessions: applyFocusSessions,
  activity_log: applyActivity,
  saved_views: applySavedViews,
  user_settings: applyPrefs,
};

/**
 * Applies one pulled page.
 *
 * Rows are grouped by table and applied parents-first, so a task never lands
 * before the project it points at. Locally that ordering is advisory rather
 * than enforced, since IndexedDB has no foreign keys, but a UI that renders a
 * task with a dangling project id for one frame is a flicker worth avoiding.
 */
const TABLE_ORDER: WireTable[] = [
  'user_settings',
  'areas',
  'projects',
  'tags',
  'task_series',
  'tasks',
];

export async function applyPage(db: TendDb, rows: PullRow[]): Promise<ApplyResult> {
  const total: ApplyResult = { applied: 0, skipped: 0 };

  const grouped = new Map<WireTable, PullRow[]>();
  for (const row of rows) {
    // A table this client has no local home for is dropped rather than raised.
    // A server that grew a table before this client shipped is a deploy skew,
    // not an error worth halting sync over.
    if (LOCAL_TABLE[row.table] === null || LOCAL_TABLE[row.table] === undefined) continue;
    const bucket = grouped.get(row.table);
    if (bucket) bucket.push(row);
    else grouped.set(row.table, [row]);
  }

  for (const table of TABLE_ORDER) {
    const bucket = grouped.get(table);
    const applier = APPLIERS[table];
    if (!bucket || !applier) continue;

    for (let i = 0; i < bucket.length; i += CHUNK_SIZE) {
      const chunk = bucket.slice(i, i + CHUNK_SIZE);
      const result = await applier(db, chunk);
      total.applied += result.applied;
      total.skipped += result.skipped;
      if (i + CHUNK_SIZE < bucket.length) await yieldToBrowser();
    }
  }

  return total;
}

/**
 * Removes a local row the server refused to create.
 *
 * The cause is always a uniqueness race. Two devices completing the same
 * recurring task offline both generate occurrence 5, `unique (series_id,
 * occurrence_seq)` lets one of them land, and the loser is holding a row that
 * exists nowhere else. Keeping it leaves that device showing the occurrence
 * twice forever, so it goes, and the winner arrives on the pull that follows.
 *
 * Writes a synced table without queueing anything, which is why it lives beside
 * the apply path rather than in the write API.
 */
export async function discardLocal(
  db: TendDb,
  table: EntityTable,
  entityId: string,
): Promise<void> {
  switch (table) {
    case 'tasks':
      await db.transaction('rw', [db.tasks, db.taskTags], async () => {
        await db.taskTags.where('taskId').equals(entityId).delete();
        await db.tasks.delete(entityId);
      });
      return;
    case 'taskTags': {
      const [taskId, tagId] = entityId.split(':');
      if (taskId && tagId) await db.taskTags.delete([taskId, tagId]);
      return;
    }
    case 'projects':
      await db.projects.delete(entityId);
      return;
    case 'tags':
      await db.tags.delete(entityId);
      return;
    case 'taskSeries':
      await db.taskSeries.delete(entityId);
      return;
    case 'prefs':
      // One row per user, created by the signup trigger. Nothing can race it.
      return;
  }
}

// ─── The cursor ───────────────────────────────────────────────────────────────

const CURSOR_KEY = 'sync.cursor';

export async function readCursor(db: TendDb): Promise<number> {
  const row = await db.syncMeta.get(CURSOR_KEY);
  return typeof row?.value === 'number' ? row.value : 0;
}

/**
 * Advances the cursor, and never moves it backwards.
 *
 * A late response from an abandoned cycle carrying an older cursor would
 * otherwise rewind progress and make the next pull re-send rows that were
 * already applied.
 */
export async function writeCursor(db: TendDb, cursor: number): Promise<void> {
  const current = await readCursor(db);
  if (cursor <= current) return;
  await db.syncMeta.put({ key: CURSOR_KEY, value: cursor });
}
