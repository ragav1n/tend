/**
 * Local row shapes.
 *
 * These mirror the Postgres tables, with two deliberate differences:
 *
 * 1. **Sentinels instead of null on anything indexed.** IndexedDB cannot index
 *    `null`, `undefined` or booleans, so a row that needs to appear in a range
 *    scan carries a derived field with a real value. `projectId` uses `''` for
 *    Inbox rather than null for the same reason.
 * 2. **Derived fields prefixed `_`.** Computed by `derive.ts` and never sent to
 *    the server. They exist so the hot queries are index-bound.
 *
 * Server-owned columns (`updatedAt`, `rowVersion`, `completedAt`, `depth`) appear
 * here because the client reads them, but `mutations.ts` never puts them in an
 * outbox patch. Triggers own them.
 */

/** Wall-clock calendar date, `YYYY-MM-DD`. Never an instant. */
export type PlainDate = string;
/** Wall-clock time of day, `HH:mm`. Never an instant. */
export type PlainTime = string;
/** ISO 8601 instant, `2026-08-18T09:15:00.000Z`. */
export type Instant = string;

/** Sorts after every real date, so "no due date" stays inside a range scan
 *  instead of needing a separate query. */
export const NO_DUE_DAY = '9999-12-31';
/** Inbox, meaning "no project". `''` sorts before every uuid. */
export const NO_PROJECT = '';
/** Top level, meaning "not a subtask". */
export const NO_PARENT = '';

export type TaskStatus = 'inbox' | 'active' | 'waiting' | 'done' | 'cancelled';
export type CancelReason = 'skipped' | 'obsolete' | 'duplicate' | 'other';

/** 0 none, 1 low, 2 medium, 3 high. Numeric so it can be indexed and sorted. */
export type Priority = 0 | 1 | 2 | 3;

export interface SyncedRow {
  id: string;
  userId: string;
  createdAt: Instant;
  /** Server-stamped. Display and debugging only, never a sync cursor. */
  updatedAt: Instant;
  /** Tombstone. A soft-deleted row keeps its content for the retention window. */
  deletedAt: Instant | null;
  /** Server-assigned monotonic counter. This is the sync cursor. 0 means the row
   *  has only ever existed locally. */
  rowVersion: number;
}

export interface DerivedTaskFields {
  /** 1 when `deletedAt` is set. Leads every compound index. */
  _del: 0 | 1;
  /** 1 when the task is done or cancelled, meaning it leaves the open lists. */
  _done: 0 | 1;
  /** `dueDate` or NO_DUE_DAY. */
  _dueDay: PlainDate;
  /** `plannedFor` or NO_DUE_DAY. */
  _plannedDay: PlainDate;
  /** Denormalized from taskTags. multiEntry indexed, so tag filtering is one scan. */
  _tagIds: string[];
  /** Lowercased, de-accented tokens from title and notes. multiEntry indexed,
   *  which gives prefix search with no search dependency. */
  _words: string[];
}

export interface Task extends SyncedRow, DerivedTaskFields {
  /** NO_PROJECT for Inbox. A subtask leaves this empty: its project is its
   *  parent's, and storing it twice invites the two to disagree. */
  projectId: string;
  /** NO_PARENT for a top-level task. */
  parentTaskId: string;
  /** Empty unless the task is an occurrence of a recurring series. */
  seriesId: string;
  /** 0 top level, 1 subtask. Capped at 1 so nothing needs a recursive CTE. */
  depth: 0 | 1;

  title: string;
  /** Markdown source. Rendered on the client. */
  notes: string;
  status: TaskStatus;
  priority: Priority;

  /** A commitment. Wall clock: due "tomorrow 9am" is 9am wherever you stand. */
  dueDate: PlainDate | null;
  /** Null means all-day. */
  dueTime: PlainTime | null;
  /** Hides the task until this date. */
  startDate: PlainDate | null;
  /** "I intend to do this today", which is what makes a Today list a plan
   *  rather than a pile of deadlines. Distinct from dueDate on purpose. */
  plannedFor: PlainDate | null;
  estimateMinutes: number | null;

  /** Server-derived from `status`. Never sent by the client. */
  completedAt: Instant | null;
  cancelReason: CancelReason | null;
  archivedAt: Instant | null;

  /** Fractional index. A string, not a number, so two offline devices can
   *  reorder different parts of a list without touching each other's rows. */
  sortKey: string;
  /** Separate ordering for the Today list, which the user arranges by hand. */
  plannedSortKey: string;

  occurrenceDate: PlainDate | null;
  occurrenceSeq: number | null;
}

export interface Project extends SyncedRow {
  areaId: string;
  name: string;
  notes: string;
  status: 'active' | 'on_hold' | 'done' | 'cancelled';
  /** Hex. Survives export and needs no lookup table. */
  color: string;
  dueDate: PlainDate | null;
  completedAt: Instant | null;
  sortKey: string;
  archivedAt: Instant | null;
  _del: 0 | 1;
  _archived: 0 | 1;
}

export interface Tag extends SyncedRow {
  name: string;
  color: string;
  sortKey: string;
  _del: 0 | 1;
}

/** Join rows are hard-deleted rather than tombstoned. The sync layer treats
 *  "the tag set for task X" as a replaceable set keyed by taskId, which avoids
 *  needing tombstones on a three-column table. */
export interface TaskTag {
  taskId: string;
  tagId: string;
  userId: string;
  createdAt: Instant;
  rowVersion: number;
}

export interface Prefs {
  /** Always 'me'. A singleton row, so the key is a constant. */
  id: 'me';
  /** IANA name. Drives every local date calculation. */
  timezone: string;
  /** ISO day of week, 1 Monday through 7 Sunday. */
  weekStart: number;
  allDayReminderTime: PlainTime;
  digestEnabled: boolean;
  digestTime: PlainTime;
  rowVersion: number;
  updatedAt: Instant;
}

// ─── Outbox ───────────────────────────────────────────────────────────────────

export type EntityTable = 'tasks' | 'projects' | 'tags' | 'taskTags' | 'prefs';
export type MutationOp = 'insert' | 'update' | 'delete' | 'undelete';
export type OutboxState = 'pending' | 'inflight' | 'failed' | 'dead';

export interface OutboxRecord {
  /** Dexie auto-increment. Gives a total order for this device, which is all the
   *  ordering the protocol needs: batches apply in array order inside one
   *  server transaction. */
  seq?: number;
  /** Server idempotency key. A retried push returns the original result rather
   *  than applying twice. */
  mutationId: string;
  /** Mutations that must land in one server transaction share a batchId, so a
   *  subtask created offline under an offline-created project commits atomically
   *  or not at all. */
  batchId: string | null;
  table: EntityTable;
  entityId: string;
  op: MutationOp;
  /** Sparse: only the changed fields. An insert carries the full row. */
  patch: Record<string, unknown>;
  /** The rowVersion the client held while editing. 0 for an insert. The server
   *  compares this against field_versions to decide the per-field merge. */
  baseVersion: number;
  /** entityIds that must exist server-side first, so the server can topologically
   *  sort within a batch to satisfy foreign keys. */
  deps: string[];
  /** Client clock. Diagnostics and intra-device ordering only, never trusted for
   *  conflict resolution. */
  createdAt: number;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: number;
  lastError?: { code: string; message: string; status?: number; at: number };
}

export interface SyncMetaRow {
  key: string;
  value: unknown;
}
