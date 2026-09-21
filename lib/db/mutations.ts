import {
  addDays,
  daysBetween,
  nextOccurrence,
  type RecurrenceRule,
} from '@/lib/recurrence';
import { swatchFor } from '@/lib/projects/palette';
import { getDb, LOCAL_USER_ID, type TendDb } from './client';
import {
  deriveActivity,
  deriveArea,
  deriveCourse,
  deriveCourseComponent,
  deriveFocusSession,
  deriveProject,
  deriveSavedView,
  deriveSeries,
  deriveTag,
  deriveTask,
  deriveTerm,
  isClosed,
} from './derive';
import { newBatchId, newId, newMutationId } from './ids';
import { DEFAULT_PREFS, PREFS_ID } from './prefs';
import { today } from './queries';
import { rankAfter, rankBefore, rankBetween } from './rank';
import { fromRule, toRule } from './series';
import {
  NO_COMPONENT,
  NO_COURSE,
  NO_DUE_DAY,
  NO_PARENT,
  NO_PROJECT,
  type ActivityAction,
  type ActivityEntry,
  type Area,
  type CancelReason,
  type EntityTable,
  type FocusSession,
  type MutationOp,
  type OutboxRecord,
  type Prefs,
  type Priority,
  type Project,
  type SavedView,
  type Course,
  type CourseComponent,
  type CourseMeeting,
  type Tag,
  type Task,
  type TaskSeries,
  type TaskStatus,
  type Term,
} from './types';

/**
 * The only write API.
 *
 * Nothing outside this file calls `db.<table>.put/add/update/delete`. Every
 * mutation here applies the optimistic local row AND appends the outbox record
 * inside one Dexie readwrite transaction, which makes "local state changed but
 * nothing got queued" impossible. That single property is why the sync engine
 * can be trusted, so it is worth the indirection.
 *
 * Fields the server owns are never put in a patch: `updatedAt`, `rowVersion`,
 * `field_versions`, `completedAt`, `depth`. Triggers set them, and the canonical
 * row comes back on the next pull.
 */

/** Fields a caller may set when creating a task. Everything else is derived. */
export interface NewTaskInput {
  title: string;
  notes?: string;
  projectId?: string;
  parentTaskId?: string;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  startDate?: string | null;
  plannedFor?: string | null;
  estimateMinutes?: number | null;
  tagIds?: string[];
  /** Explicit position. Defaults to the end of the list. */
  sortKey?: string;
  courseId?: string;
}

/** Fields a caller may change. Server-owned columns are absent by construction. */
export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'notes'
    | 'projectId'
    | 'parentTaskId'
    | 'status'
    | 'priority'
    | 'dueDate'
    | 'dueTime'
    | 'startDate'
    | 'plannedFor'
    | 'estimateMinutes'
    | 'cancelReason'
    | 'archivedAt'
    | 'sortKey'
    | 'plannedSortKey'
    | 'seriesId'
    | 'occurrenceDate'
    | 'occurrenceSeq'
    | 'courseId'
    | 'componentId'
    | 'pointsPossible'
    | 'pointsEarned'
    | 'gradedAt'
  >
>;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Columns the client must never send. Derived fields are local-only, and the rest
 * are stamped by Postgres triggers, so including any of them in a patch either
 * gets rejected or fights the server for ownership.
 */
const NOT_CLIENT_WRITABLE = new Set([
  '_del',
  '_done',
  '_dueDay',
  '_plannedDay',
  '_tagIds',
  '_words',
  '_archived',
  '_undone',
  'updatedAt',
  'rowVersion',
  'completedAt',
  'cancelledAt',
  'depth',
]);

/** Full-row insert patch, with the server-owned columns stripped. */
function toInsertPatch(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!NOT_CLIENT_WRITABLE.has(k)) out[k] = v;
  }
  return out;
}

/** Builds one outbox record. Never called outside this file. */
function outboxRecord(
  table: EntityTable,
  entityId: string,
  op: MutationOp,
  patch: Record<string, unknown>,
  baseVersion: number,
  opts: { batchId?: string | null; deps?: string[] } = {},
): OutboxRecord {
  return {
    mutationId: newMutationId(),
    batchId: opts.batchId ?? null,
    table,
    entityId,
    op,
    patch,
    baseVersion,
    deps: opts.deps ?? [],
    createdAt: Date.now(),
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
  };
}

/**
 * The rank a row takes between two neighbours, either of which may be missing.
 *
 * Shared by every reorder, because the four-way choice was written out three
 * times and the ends are the part that is easy to get wrong: moving to the top of
 * a list is `prev === null`, not `rankAfter(null)`, which would land it at the
 * bottom.
 */
function rankAmong(prevSortKey: string | null, nextSortKey: string | null): string {
  if (prevSortKey === null && nextSortKey === null) return rankAfter(null);
  if (prevSortKey === null) return rankBefore(nextSortKey);
  if (nextSortKey === null) return rankAfter(prevSortKey);
  return rankBetween(prevSortKey, nextSortKey);
}

/** Rank at the end of a list, given the rows already in it. */
function endRank(existing: readonly string[]): string {
  if (existing.length === 0) return rankAfter(null);
  const last = [...existing].sort()[existing.length - 1];
  return rankAfter(last ?? null);
}

// ─── The activity log ─────────────────────────────────────────────────────────
// Undo is a forward mutation, not a server-side revert: it writes the old values
// back through the same outbox every other edit uses. A revert that skipped the
// outbox would be invisible to every other device, which for a protocol built on
// last-writer-wins per field means the change would come straight back on the
// next pull.

/** Tables every logged task mutation touches. Named once so the transaction
 *  lists cannot drift apart, which in Dexie fails at runtime and only for the
 *  path that was missed. */
const TASK_TABLES = (db: TendDb) => [db.tasks, db.taskTags, db.outbox, db.activityLog];

interface LogInput {
  action: ActivityAction;
  entityId: string;
  /** One user gesture. A single edit is a group of one. */
  group: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  summary: string;
}

/** Writes one entry. Called inside the caller's transaction, never on its own,
 *  so "changed but not recorded" is impossible the same way "changed but not
 *  queued" is. */
async function logActivity(db: TendDb, input: LogInput): Promise<void> {
  const base = {
    id: newId(),
    userId: LOCAL_USER_ID,
    action: input.action,
    entityTable: 'tasks' as const,
    entityId: input.entityId,
    groupId: input.group,
    before: input.before ?? {},
    after: input.after ?? {},
    summary: input.summary,
    undoneAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
    rowVersion: 0,
  };

  const row: ActivityEntry = { ...base, ...deriveActivity(base) };
  await db.activityLog.add(row);
  await db.outbox.add(
    outboxRecord('activityLog', row.id, 'insert', toInsertPatch(row), 0),
  );
}

/** What a toast says it took back. */
function summarize(action: ActivityAction, title: string): string {
  const verb: Record<ActivityAction, string> = {
    create: 'Added',
    update: 'Edited',
    complete: 'Completed',
    reopen: 'Reopened',
    delete: 'Deleted',
    restore: 'Restored',
  };
  return `${verb[action]} "${title}"`;
}

/**
 * The same sentence for a verb the action cannot name.
 *
 * Cancelling is logged as an `update`, so the undo path reverses it by restoring
 * fields rather than needing a case of its own. "Edited" is not what happened
 * though, and the toast is the only place the person finds out what they just
 * did.
 */
function summarizeAs(verb: string, title: string): string {
  return `${verb} "${title}"`;
}

/** The fields a patch is about to overwrite, as they stand. */
function previousValues(row: Task, patch: TaskPatch): Record<string, unknown> {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    before[key] = (row as unknown as Record<string, unknown>)[key];
  }
  return before;
}

/**
 * The write half of `updateTask`, with no entry of its own.
 *
 * Undo and `completeTask` both need to move fields without that move becoming
 * new history: undo already has an entry to mark, and a completion is a
 * completion rather than an edit to `status`.
 *
 * Returns the row as it was, or null when there was nothing to change.
 */
async function writeTaskPatch(
  id: string,
  patch: TaskPatch,
  db: TendDb,
): Promise<Task | null> {
  const current = await db.tasks.get(id);
  if (!current) return null;

  const next = { ...current, ...patch, updatedAt: nowIso() };

  // completedAt is server-derived, but the optimistic row still needs a value
  // so the UI can show "done 2 minutes ago" before the next pull lands.
  //
  // cancelledAt matters more than that. Only cancelled rows carry one, which is
  // what makes `[_del+cancelledAt]` the cancelled list, so a row left without it
  // until the next pull is a row that left the open lists and reached nothing.
  // Offline, or signed out, there is no next pull and this is the only thing
  // that ever sets it.
  if (patch.status !== undefined && patch.status !== current.status) {
    next.completedAt = patch.status === 'done' ? nowIso() : null;
    next.cancelledAt = patch.status === 'cancelled' ? nowIso() : null;
    // The reason goes with the status it explains. Unchecking a cancelled row
    // in the pile is a reopen, and leaving "duplicate" on a task that is back on
    // the list is a field that outlived the thing it was about.
    if (patch.status !== 'cancelled' && patch.cancelReason === undefined) {
      next.cancelReason = null;
    }
  }
  if (patch.parentTaskId !== undefined) {
    next.depth = patch.parentTaskId === NO_PARENT ? 0 : 1;
  }

  const tagIds = (await db.taskTags.where('taskId').equals(id).toArray()).map((t) => t.tagId);
  const row: Task = { ...next, ...deriveTask(next, tagIds) };
  await db.tasks.put(row);

  await db.outbox.add(outboxRecord('tasks', id, 'update', { ...patch }, current.rowVersion));
  return current;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function createTask(input: NewTaskInput, db: TendDb = getDb()): Promise<string> {
  const id = newId();
  const parentTaskId = input.parentTaskId ?? NO_PARENT;
  const tagIds = input.tagIds ?? [];
  const batchId = tagIds.length > 0 ? newBatchId() : null;

  await db.transaction('rw', TASK_TABLES(db), async () => {
    // Rank against the list the task is actually joining, so a new subtask lands
    // at the end of its parent's children rather than the end of the project.
    const siblings =
      parentTaskId === NO_PARENT
        ? await db.tasks
            .where('[_del+projectId+_done+sortKey]')
            .between([0, input.projectId ?? NO_PROJECT, 0, ''], [0, input.projectId ?? NO_PROJECT, 0, '￿'])
            .toArray()
        : await db.tasks
            .where('[_del+parentTaskId+sortKey]')
            .between([0, parentTaskId, ''], [0, parentTaskId, '￿'])
            .toArray();

    const sortKey = input.sortKey ?? endRank(siblings.map((t) => t.sortKey));

    const base = {
      id,
      userId: LOCAL_USER_ID,
      projectId: parentTaskId === NO_PARENT ? (input.projectId ?? NO_PROJECT) : NO_PROJECT,
      courseId: parentTaskId === NO_PARENT ? (input.courseId ?? NO_COURSE) : NO_COURSE,
      parentTaskId,
      seriesId: '',
      depth: (parentTaskId === NO_PARENT ? 0 : 1) as 0 | 1,
      title: input.title,
      notes: input.notes ?? '',
      status: input.status ?? 'inbox',
      priority: input.priority ?? 0,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      startDate: input.startDate ?? null,
      plannedFor: input.plannedFor ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
      componentId: NO_COMPONENT,
      pointsPossible: null,
      pointsEarned: null,
      gradedAt: null,
      archivedAt: null,
      sortKey,
      plannedSortKey: sortKey,
      occurrenceDate: null,
      occurrenceSeq: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };

    const row: Task = { ...base, ...deriveTask(base, tagIds) };
    await db.tasks.add(row);

    await db.outbox.add(
      outboxRecord('tasks', id, 'insert', toInsertPatch(row), 0, { batchId }),
    );

    for (const tagId of tagIds) {
      await db.taskTags.add({
        taskId: id,
        tagId,
        userId: LOCAL_USER_ID,
        createdAt: nowIso(),
        rowVersion: 0,
      });
      // deps tells the server to order the task insert before the join row, so
      // a task and its tags created offline commit as one transaction.
      await db.outbox.add(
        outboxRecord('taskTags', `${id}:${tagId}`, 'insert', { taskId: id, tagId }, 0, {
          batchId,
          deps: [id, tagId],
        }),
      );
    }

    await logActivity(db, {
      action: 'create',
      entityId: id,
      group: newId(),
      after: { title: input.title },
      summary: summarize('create', input.title),
    });
  });

  return id;
}

export async function updateTask(
  id: string,
  patch: TaskPatch,
  db: TendDb = getDb(),
): Promise<void> {
  await updateTasks([id], patch, db);
}

/**
 * The same patch across several tasks, as one undo step.
 *
 * Each task still gets its own outbox record. A bulk edit that pushed as one
 * unit would strand nineteen good writes behind one bad row, which is the
 * failure 0017 was written to stop.
 */
export async function updateTasks(
  ids: readonly string[],
  patch: TaskPatch,
  db: TendDb = getDb(),
): Promise<void> {
  const group = newId();

  await db.transaction('rw', TASK_TABLES(db), async () => {
    for (const id of ids) {
      const before = await writeTaskPatch(id, patch, db);
      if (!before) continue;

      await logActivity(db, {
        action: 'update',
        entityId: id,
        group,
        before: previousValues(before, patch),
        after: { ...patch },
        summary: summarize('update', before.title),
      });
    }
  });
}

/**
 * Completing a task is its own function rather than an `updateTask` call,
 * because it is the app's most common mutation and because a recurring task also
 * has to materialize its next occurrence. That generation happens locally with
 * no server round trip, so it works offline.
 *
 * Returns the id of the occurrence that was created, or null when nothing
 * recurred, so the caller can scroll to it or say so.
 */
export async function completeTask(
  id: string,
  done = true,
  db: TendDb = getDb(),
): Promise<string | null> {
  const created = await completeTasks([id], done, db);
  return created[id] ?? null;
}

/**
 * Several completions as one undo step.
 *
 * Returns the occurrence each recurring task spawned, keyed by the task that
 * spawned it, because undoing a completion has to take the next occurrence back
 * with it. A recurring task reopened while its successor survives leaves two
 * open occurrences of a series that promises exactly one.
 */
export async function completeTasks(
  ids: readonly string[],
  done = true,
  db: TendDb = getDb(),
): Promise<Record<string, string>> {
  const created: Record<string, string> = {};
  const group = newId();

  await db.transaction('rw', [...TASK_TABLES(db), db.taskSeries], async () => {
    for (const id of ids) {
      // Read before the write, so the clone copies the status the task had
      // rather than the 'done' it is about to get.
      const before = await db.tasks.get(id);
      if (!before) continue;

      const status: TaskStatus = done ? 'done' : 'active';
      if (!(await writeTaskPatch(id, { status }, db))) continue;

      const { spawnedId, advancedSeriesId } =
        done && before.seriesId !== ''
          ? await materializeNext(before, db)
          : NOTHING_MATERIALIZED;
      if (spawnedId) created[id] = spawnedId;

      await logActivity(db, {
        action: done ? 'complete' : 'reopen',
        entityId: id,
        group,
        before: { status: before.status },
        after: {
          status,
          ...(spawnedId ? { spawnedId } : {}),
          ...(advancedSeriesId ? { advancedSeriesId } : {}),
        },
        summary: summarize(done ? 'complete' : 'reopen', before.title),
      });
    }
  });

  return created;
}

/**
 * Gives up on a task, with a reason.
 *
 * `cancelled` and `cancelReason` have been in the schema, in `derive.ts` and in
 * `activity/describe.ts` since phase 1, and nothing wrote them. The point of the
 * status is the thing `done` cannot say: an assignment you dropped, a duplicate,
 * a piece of work that stopped mattering. Counting those as finished is what
 * makes a completion count meaningless.
 *
 * Logged as an `update` rather than an action of its own, so the undo path
 * already knows how to reverse it: it restores the fields in `before` through
 * `writeTaskPatch`, which is exactly what taking a cancellation back is.
 *
 * The series is left alone. The next occurrence of a repeat is materialized when
 * one is completed, so cancelling one ends the repeat there, the same way
 * deleting it would. That is said out loud in the UI rather than worked around
 * with a second materialization path, because a cancel that quietly spawned a
 * successor would leave two open occurrences of a series that promises one.
 */
export async function cancelTasks(
  ids: readonly string[],
  reason: CancelReason = 'other',
  db: TendDb = getDb(),
): Promise<void> {
  const group = newId();

  await db.transaction('rw', TASK_TABLES(db), async () => {
    for (const id of ids) {
      const before = await db.tasks.get(id);
      if (!before || before.status === 'cancelled') continue;

      if (!(await writeTaskPatch(id, { status: 'cancelled', cancelReason: reason }, db))) continue;

      await logActivity(db, {
        action: 'update',
        entityId: id,
        group,
        before: { status: before.status, cancelReason: before.cancelReason },
        after: { status: 'cancelled', cancelReason: reason },
        summary: summarizeAs('Cancelled', before.title),
      });
    }
  });
}

/**
 * Puts a cancelled task back on the list it came from.
 *
 * `active` rather than the status it held before, which `inbox` usually was. A
 * task somebody just decided to keep is a task they mean to do, and the activity
 * log still holds the original for an undo to restore.
 */
export async function uncancelTasks(
  ids: readonly string[],
  db: TendDb = getDb(),
): Promise<void> {
  const group = newId();

  await db.transaction('rw', TASK_TABLES(db), async () => {
    for (const id of ids) {
      const before = await db.tasks.get(id);
      if (!before || before.status !== 'cancelled') continue;

      if (!(await writeTaskPatch(id, { status: 'active', cancelReason: null }, db))) continue;

      await logActivity(db, {
        action: 'update',
        entityId: id,
        group,
        before: { status: before.status, cancelReason: before.cancelReason },
        after: { status: 'active', cancelReason: null },
        summary: summarizeAs('Kept', before.title),
      });
    }
  });
}

/**
 * Clones the completed occurrence forward.
 *
 * The clone is what makes the series row hold nothing but the rule: there is no
 * second set of template columns that can drift out of step with the task the
 * user actually edits.
 */
interface Materialized {
  /** The occurrence that was created, or null when the series ended here. */
  spawnedId: string | null;
  /** The series whose `completedCount` this advanced. Recorded separately from
   *  `spawnedId` because the count moves even when the series ends and nothing
   *  is created, and undo has to put both back. */
  advancedSeriesId: string | null;
}

const NOTHING_MATERIALIZED: Materialized = { spawnedId: null, advancedSeriesId: null };

async function materializeNext(completed: Task, db: TendDb): Promise<Materialized> {
  const series = await db.taskSeries.get(completed.seriesId);
  if (!series || series._del === 1) return NOTHING_MATERIALIZED;

  const day = today();
  const result = nextOccurrence({
    rule: toRule(series),
    occurrenceDate: completed.occurrenceDate ?? completed.dueDate ?? day,
    completedOn: day,
    today: day,
    completedCount: series.completedCount,
  });

  // The count advances even when the series ends here, because it records
  // completions rather than generations and endsAfterCount reads it next time.
  const seriesPatch = { completedCount: series.completedCount + 1 };
  await db.taskSeries.put({ ...series, ...seriesPatch, updatedAt: nowIso() });
  await db.outbox.add(
    outboxRecord('taskSeries', series.id, 'update', seriesPatch, series.rowVersion),
  );

  if (result.kind === 'ended') return { spawnedId: null, advancedSeriesId: series.id };

  const id = newId();
  const tagIds = (await db.taskTags.where('taskId').equals(completed.id).toArray()).map(
    (t) => t.tagId,
  );
  const batchId = tagIds.length > 0 ? newBatchId() : null;

  // A lead time is a gap, not a date, so it moves with the occurrence.
  const startDate =
    completed.startDate && completed.dueDate
      ? addDays(result.date, daysBetween(completed.dueDate, completed.startDate))
      : null;

  const base = {
    id,
    userId: LOCAL_USER_ID,
    projectId: completed.projectId,
    parentTaskId: completed.parentTaskId,
    seriesId: completed.seriesId,
    depth: completed.depth,
    title: completed.title,
    notes: completed.notes,
    status: isClosed(completed.status) ? ('active' as TaskStatus) : completed.status,
    priority: completed.priority,
    dueDate: result.date,
    dueTime: completed.dueTime,
    startDate,
    // Today's plan is a decision about today, so it does not travel forward.
    plannedFor: null,
    estimateMinutes: completed.estimateMinutes,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    // The next occurrence is the same coursework, so it keeps the course and the
    // bucket it counts toward. It does not keep the marks: a grade belongs to
    // the occurrence that earned it.
    courseId: completed.courseId,
    componentId: completed.componentId,
    pointsPossible: completed.pointsPossible,
    pointsEarned: null,
    gradedAt: null,
    archivedAt: null,
    // The new occurrence takes the old one's place in the list. Reusing the key
    // costs no query, and the completed row has already left the open lists.
    sortKey: completed.sortKey,
    plannedSortKey: completed.plannedSortKey,
    occurrenceDate: result.date,
    // Exactly +1, never +1+skipped: two devices in different zones compute
    // different skip counts, and the server's unique (series_id, occurrence_seq)
    // is what stops both of them creating occurrence 5. A seq derived from
    // anything zone-dependent would let the duplicate through.
    occurrenceSeq: (completed.occurrenceSeq ?? 0) + 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
    rowVersion: 0,
  };

  const row: Task = { ...base, ...deriveTask(base, tagIds) };
  await db.tasks.add(row);
  await db.outbox.add(outboxRecord('tasks', id, 'insert', toInsertPatch(row), 0, { batchId }));

  for (const tagId of tagIds) {
    await db.taskTags.add({
      taskId: id,
      tagId,
      userId: LOCAL_USER_ID,
      createdAt: nowIso(),
      rowVersion: 0,
    });
    await db.outbox.add(
      outboxRecord('taskTags', `${id}:${tagId}`, 'insert', { taskId: id, tagId }, 0, {
        batchId,
        deps: [id, tagId],
      }),
    );
  }

  return { spawnedId: id, advancedSeriesId: series.id };
}

/**
 * Puts a series' completion counter back by one.
 *
 * `materializeNext` advances it on every completion, including the one that
 * ends the series and creates nothing, so undoing a completion has to reverse
 * that too. Without it, five complete-then-undo cycles on an `after_count`
 * series burn five of its occurrences and it stops early with nothing to show.
 */
async function rewindSeriesCount(seriesId: string, db: TendDb): Promise<void> {
  const series = await db.taskSeries.get(seriesId);
  if (!series || series._del === 1) return;

  const patch = { completedCount: Math.max(0, series.completedCount - 1) };
  if (patch.completedCount === series.completedCount) return;

  const next = { ...series, ...patch, updatedAt: nowIso() };
  await db.taskSeries.put({ ...next, ...deriveSeries(next) });
  await db.outbox.add(outboxRecord('taskSeries', series.id, 'update', patch, series.rowVersion));
}

/** Soft delete. The row keeps its content so restore is just another field write. */
export async function deleteTask(id: string, db: TendDb = getDb()): Promise<void> {
  await deleteTasks([id], db);
}

/** Several deletes as one undo step. */
export async function deleteTasks(
  ids: readonly string[],
  db: TendDb = getDb(),
): Promise<void> {
  const group = newId();
  await db.transaction('rw', TASK_TABLES(db), async () => {
    for (const id of ids) {
      const current = await writeDelete(id, db);
      if (!current) continue;
      await logActivity(db, {
        action: 'delete',
        entityId: id,
        group,
        summary: summarize('delete', current.title),
      });
    }
  });
}

/**
 * The write half of a delete, with no entry of its own.
 *
 * Must be called inside a transaction already covering `tasks`, `taskTags` and
 * `outbox`. It opens none itself, because both callers, `deleteTasks` and
 * `revertActivity`, need several of these to land together.
 */
async function writeDelete(id: string, db: TendDb): Promise<Task | null> {
  const current = await db.tasks.get(id);
  if (!current) return null;

  const deletedAt = nowIso();
  const tagIds = (await db.taskTags.where('taskId').equals(id).toArray()).map((t) => t.tagId);

  // Cascade to subtasks, matching the Postgres ON DELETE CASCADE on the
  // composite parent key, so local and server agree on what a delete removes.
  // Children already deleted are left alone: re-stamping deletedAt would
  // restart their retention window, queue a pointless mutation, and make them
  // look like part of this delete to the undo that follows it.
  const children = (await db.tasks.where('parentTaskId').equals(id).toArray()).filter(
    (t) => t.deletedAt === null,
  );

  for (const row of [current, ...children]) {
    const next = { ...row, deletedAt, updatedAt: deletedAt };
    const childTagIds =
      row.id === id
        ? tagIds
        : (await db.taskTags.where('taskId').equals(row.id).toArray()).map((t) => t.tagId);
    await db.tasks.put({ ...next, ...deriveTask(next, childTagIds) });
    await db.outbox.add(outboxRecord('tasks', row.id, 'delete', { deletedAt }, row.rowVersion));
  }

  return current;
}

/**
 * Undo of a delete, which is why it cascades the way the delete did.
 *
 * Only children carrying the parent's exact `deletedAt` come back. Restoring
 * every child would resurrect subtasks that were deleted on their own weeks
 * earlier, and an undo toast that quietly does more than it undid is worse than
 * no undo at all.
 */
export async function restoreTask(id: string, db: TendDb = getDb()): Promise<void> {
  await restoreTasks([id], db);
}

/** Several restores as one undo step. */
export async function restoreTasks(
  ids: readonly string[],
  db: TendDb = getDb(),
): Promise<void> {
  const group = newId();
  await db.transaction('rw', TASK_TABLES(db), async () => {
    for (const id of ids) {
      const current = await writeRestore(id, db);
      if (!current) continue;
      await logActivity(db, {
        action: 'restore',
        entityId: id,
        group,
        summary: summarize('restore', current.title),
      });
    }
  });
}

/** The write half of a restore, with the same transaction requirement as
 *  `writeDelete`. */
async function writeRestore(id: string, db: TendDb): Promise<Task | null> {
  const current = await db.tasks.get(id);
  if (!current) return null;

  const children = (await db.tasks.where('parentTaskId').equals(id).toArray()).filter(
    (t) => t.deletedAt !== null && t.deletedAt === current.deletedAt,
  );

  for (const row of [current, ...children]) {
    const next = { ...row, deletedAt: null, updatedAt: nowIso() };
    const tagIds = (await db.taskTags.where('taskId').equals(row.id).toArray()).map((t) => t.tagId);
    await db.tasks.put({ ...next, ...deriveTask(next, tagIds) });
    await db.outbox.add(
      outboxRecord('tasks', row.id, 'undelete', { deletedAt: null }, row.rowVersion),
    );
  }

  return current;
}

/**
 * Puts a group of entries back the way they were.
 *
 * The reversal writes go through the same unlogged helpers `updateTask` and
 * `deleteTask` use, so every device sees them as ordinary edits. They record no
 * new history of their own: the entry gets `undoneAt` instead, which is both
 * what makes the stack skip it next time and an honest account of what
 * happened. A reversal logged as a fresh change would make the next undo redo
 * it, and a stack that alternates is not an undo stack.
 *
 * Entries are reversed newest first, because a group can contain two writes to
 * one field and only the oldest `before` is the value to land on. The order
 * comes from the id rather than `createdAt`: ids are UUIDv7, which is monotonic
 * inside a millisecond, and a bulk edit writes its whole group inside one.
 */
export async function revertActivity(
  entries: readonly ActivityEntry[],
  db: TendDb = getDb(),
): Promise<void> {
  const ordered = [...entries].sort((a, b) => b.id.localeCompare(a.id));
  const undoneAt = nowIso();

  // taskSeries is in the list because undoing a completion has to rewind the
  // counter materializeNext advanced. Without it this could not write that row
  // even if it wanted to.
  await db.transaction('rw', [...TASK_TABLES(db), db.taskSeries], async () => {
    for (const entry of ordered) {
      switch (entry.action) {
        case 'create':
          await writeDelete(entry.entityId, db);
          break;
        case 'delete':
          await writeRestore(entry.entityId, db);
          break;
        case 'restore':
          await writeDelete(entry.entityId, db);
          break;
        case 'complete':
        case 'reopen':
        case 'update': {
          await writeTaskPatch(entry.entityId, entry.before as TaskPatch, db);
          // A completed recurring task spawned its successor. Reopening the one
          // without removing the other leaves two open occurrences of a series
          // that promises exactly one.
          const spawned = entry.after.spawnedId;
          if (typeof spawned === 'string' && spawned !== '') await writeDelete(spawned, db);
          // And the counter moves on every completion, including the one that
          // ended the series and spawned nothing.
          const advanced = entry.after.advancedSeriesId;
          if (typeof advanced === 'string' && advanced !== '') {
            await rewindSeriesCount(advanced, db);
          }
          break;
        }
      }

      const next = { ...entry, undoneAt, updatedAt: undoneAt };
      await db.activityLog.put({ ...next, ...deriveActivity(next) });
      await db.outbox.add(
        outboxRecord('activityLog', entry.id, 'update', { undoneAt }, entry.rowVersion),
      );
    }
  });
}

/**
 * Moves a task between two neighbours. Only the moved row changes, which is what
 * makes concurrent reordering on two offline devices safe.
 */
export async function reorderTask(
  id: string,
  prevSortKey: string | null,
  nextSortKey: string | null,
  field: 'sortKey' | 'plannedSortKey' = 'sortKey',
  db: TendDb = getDb(),
): Promise<void> {
  const sortKey = rankAmong(prevSortKey, nextSortKey);

  // Unlogged: a drag has its own undo, which is dragging it back, and a
  // reorder in the stack would sit between the edits people actually want to
  // take back.
  await db.transaction('rw', [db.tasks, db.taskTags, db.outbox], async () => {
    await writeTaskPatch(id, { [field]: sortKey } as TaskPatch, db);
  });
}

/** Replaces the whole tag set for a task, which is how the sync layer models it. */
export async function setTaskTags(
  taskId: string,
  tagIds: string[],
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.tasks, db.taskTags, db.outbox], async () => {
    const task = await db.tasks.get(taskId);
    if (!task) return;

    const existing = await db.taskTags.where('taskId').equals(taskId).toArray();
    const existingIds = new Set(existing.map((t) => t.tagId));
    const wanted = new Set(tagIds);

    for (const tagId of wanted) {
      if (existingIds.has(tagId)) continue;
      await db.taskTags.add({
        taskId,
        tagId,
        userId: LOCAL_USER_ID,
        createdAt: nowIso(),
        rowVersion: 0,
      });
      await db.outbox.add(
        outboxRecord('taskTags', `${taskId}:${tagId}`, 'insert', { taskId, tagId }, 0, {
          deps: [taskId, tagId],
        }),
      );
    }

    for (const row of existing) {
      if (wanted.has(row.tagId)) continue;
      await db.taskTags.delete([row.taskId, row.tagId]);
      await db.outbox.add(
        outboxRecord('taskTags', `${taskId}:${row.tagId}`, 'delete', { taskId, tagId: row.tagId }, 0),
      );
    }

    const next = { ...task, updatedAt: nowIso() };
    await db.tasks.put({ ...next, ...deriveTask(next, [...wanted]) });
  });
}

// ─── Recurrence ───────────────────────────────────────────────────────────────

/**
 * Makes a task repeat, or edits the rule it already repeats by.
 *
 * The task points at the series rather than the other way round, so the series
 * row never has to be found by scanning tasks, and exactly one open occurrence
 * exists at a time.
 */
export async function setTaskRecurrence(
  taskId: string,
  rule: RecurrenceRule,
  db: TendDb = getDb(),
): Promise<string | null> {
  let seriesId: string | null = null;

  await db.transaction('rw', [db.tasks, db.taskTags, db.taskSeries, db.outbox], async () => {
    const task = await db.tasks.get(taskId);
    if (!task) return;

    const fields = fromRule(rule);
    const existing = task.seriesId ? await db.taskSeries.get(task.seriesId) : undefined;

    if (existing && existing._del === 0) {
      seriesId = existing.id;
      const next = { ...existing, ...fields, updatedAt: nowIso() };
      await db.taskSeries.put({ ...next, ...deriveSeries(next) });
      await db.outbox.add(
        outboxRecord('taskSeries', existing.id, 'update', { ...fields }, existing.rowVersion),
      );
      return;
    }

    const id = newId();
    seriesId = id;
    const base = {
      id,
      userId: LOCAL_USER_ID,
      kind: 'structured' as const,
      ...fields,
      completedCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };
    const row: TaskSeries = { ...base, ...deriveSeries(base) };
    await db.taskSeries.add(row);
    await db.outbox.add(outboxRecord('taskSeries', id, 'insert', toInsertPatch(row), 0));

    // The anchor the first generation steps from. A task with no due date still
    // needs one, or "every 3 days" has nothing to count from.
    // Unlogged. Undo restoring `seriesId` while the series row it points at
    // stayed would be a half-undo, and a half-undo is worse than none.
    await writeTaskPatch(
      taskId,
      { seriesId: id, occurrenceDate: task.dueDate ?? today(), occurrenceSeq: 0 },
      db,
    );
  });

  return seriesId;
}

/**
 * Stops a task repeating. The series is tombstoned rather than unlinked, so
 * completed occurrences keep pointing at a row that explains where they came
 * from instead of at a dangling id.
 */
export async function clearTaskRecurrence(
  taskId: string,
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.tasks, db.taskTags, db.taskSeries, db.outbox], async () => {
    const task = await db.tasks.get(taskId);
    if (!task || task.seriesId === '') return;

    const series = await db.taskSeries.get(task.seriesId);
    if (series && series._del === 0) {
      const deletedAt = nowIso();
      const next = { ...series, deletedAt, updatedAt: deletedAt };
      await db.taskSeries.put({ ...next, ...deriveSeries(next) });
      await db.outbox.add(
        outboxRecord('taskSeries', series.id, 'delete', { deletedAt }, series.rowVersion),
      );
    }

    await writeTaskPatch(taskId, { seriesId: '', occurrenceDate: null, occurrenceSeq: null }, db);
  });
}

// ─── Saved views ──────────────────────────────────────────────────────────────

export interface NewViewInput {
  name: string;
  icon?: string;
  filter?: Record<string, unknown>;
  sort?: string;
  pinned?: boolean;
}

export type ViewPatch = Partial<Pick<SavedView, 'name' | 'icon' | 'filter' | 'sort' | 'pinned' | 'sortKey'>>;

export async function createSavedView(
  input: NewViewInput,
  db: TendDb = getDb(),
): Promise<string> {
  const id = newId();

  await db.transaction('rw', [db.savedViews, db.outbox], async () => {
    const existing = await db.savedViews.where('_del').equals(0).toArray();
    const base = {
      id,
      userId: LOCAL_USER_ID,
      name: input.name,
      icon: input.icon ?? 'Funnel',
      filter: input.filter ?? {},
      sort: input.sort ?? 'manual',
      pinned: input.pinned ?? true,
      sortKey: endRank(existing.map((view) => view.sortKey)),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };

    const row: SavedView = { ...base, ...deriveSavedView(base) };
    await db.savedViews.add(row);
    await db.outbox.add(outboxRecord('savedViews', id, 'insert', toInsertPatch(row), 0));
  });

  return id;
}

export async function updateSavedView(
  id: string,
  patch: ViewPatch,
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.savedViews, db.outbox], async () => {
    const current = await db.savedViews.get(id);
    if (!current) return;

    const next = { ...current, ...patch, updatedAt: nowIso() };
    await db.savedViews.put({ ...next, ...deriveSavedView(next) });
    await db.outbox.add(
      outboxRecord('savedViews', id, 'update', { ...patch }, current.rowVersion),
    );
  });
}

/** Soft delete, like everything else here: the row keeps its content so the
 *  undo toast is a field write rather than a re-create with a new id. */
export async function deleteSavedView(id: string, db: TendDb = getDb()): Promise<void> {
  await db.transaction('rw', [db.savedViews, db.outbox], async () => {
    const current = await db.savedViews.get(id);
    if (!current) return;

    const deletedAt = nowIso();
    const next = { ...current, deletedAt, updatedAt: deletedAt };
    await db.savedViews.put({ ...next, ...deriveSavedView(next) });
    await db.outbox.add(
      outboxRecord('savedViews', id, 'delete', { deletedAt }, current.rowVersion),
    );
  });
}

export async function restoreSavedView(id: string, db: TendDb = getDb()): Promise<void> {
  await db.transaction('rw', [db.savedViews, db.outbox], async () => {
    const current = await db.savedViews.get(id);
    if (!current) return;

    const next = { ...current, deletedAt: null, updatedAt: nowIso() };
    await db.savedViews.put({ ...next, ...deriveSavedView(next) });
    await db.outbox.add(
      outboxRecord('savedViews', id, 'undelete', { deletedAt: null }, current.rowVersion),
    );
  });
}

// ─── Focus ────────────────────────────────────────────────────────────────────

/**
 * Opens a session when the timer starts, not when it stops.
 *
 * A phone kills a backgrounded tab without warning, and a session that only
 * exists in memory until it ends is a session that vanishes exactly when
 * somebody focused for 40 minutes. The row is written first and finished later,
 * so the worst case loses the last few minutes rather than all of them.
 */
export async function startFocusSession(
  input: { taskId?: string; plannedMinutes: number; startedAt?: string },
  db: TendDb = getDb(),
): Promise<string> {
  const id = newId();

  await db.transaction('rw', [db.focusSessions, db.outbox], async () => {
    const base = {
      id,
      userId: LOCAL_USER_ID,
      taskId: input.taskId ?? '',
      startedAt: input.startedAt ?? nowIso(),
      endedAt: null,
      plannedMinutes: input.plannedMinutes,
      focusedSeconds: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };
    const row: FocusSession = { ...base, ...deriveFocusSession(base) };
    await db.focusSessions.add(row);
    await db.outbox.add(outboxRecord('focusSessions', id, 'insert', toInsertPatch(row), 0));
  });

  return id;
}

/**
 * Records what the timer measured.
 *
 * Called on every pause as well as at the end, so a crash between two pauses
 * costs one interval. `endedAt` is what makes a session finished, which is why
 * a pause passes null for it.
 */
export async function updateFocusSession(
  id: string,
  patch: { focusedSeconds?: number; endedAt?: string | null },
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.focusSessions, db.outbox], async () => {
    const current = await db.focusSessions.get(id);
    if (!current) return;

    const next = { ...current, ...patch, updatedAt: nowIso() };
    await db.focusSessions.put({ ...next, ...deriveFocusSession(next) });
    await db.outbox.add(
      outboxRecord('focusSessions', id, 'update', { ...patch }, current.rowVersion),
    );
  });
}

// ─── Areas ────────────────────────────────────────────────────────────────────
// An area is a folder for projects. It has existed server-side since 0001 so a
// project could point at one; these are the writes that finally let somebody
// make one.

export async function createArea(input: { name: string }, db: TendDb = getDb()): Promise<string> {
  const id = newId();
  await db.transaction('rw', [db.areas, db.outbox], async () => {
    const existing = await db.areas.where('_del').equals(0).toArray();
    const base = {
      id,
      userId: LOCAL_USER_ID,
      name: input.name,
      sortKey: endRank(existing.map((a) => a.sortKey)),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };
    const row: Area = { ...base, ...deriveArea(base) };
    await db.areas.add(row);

    await db.outbox.add(outboxRecord('areas', id, 'insert', toInsertPatch(row), 0));
  });
  return id;
}

export type AreaPatch = Partial<Pick<Area, 'name' | 'sortKey'>>;

export async function updateArea(
  id: string,
  patch: AreaPatch,
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.areas, db.outbox], async () => {
    const current = await db.areas.get(id);
    if (!current) return;

    const next = { ...current, ...patch, updatedAt: nowIso() };
    await db.areas.put({ ...next, ...deriveArea(next) });
    await db.outbox.add(outboxRecord('areas', id, 'update', { ...patch }, current.rowVersion));
  });
}

/**
 * Tombstones an area and returns the projects it let go of.
 *
 * Postgres would clear `area_id` itself through `on delete set null`, but a soft
 * delete never fires that, so the projects would keep pointing at a tombstone
 * and drop out of the screen entirely: the index the list reads is grouped by
 * area, and an area that is not there has no group to render into. Clearing the
 * reference here is what keeps every project reachable.
 *
 * The ids come back so the caller's undo can put them where they were. Without
 * them a restore would hand back an empty folder, which is the kind of half-undo
 * this codebase keeps out of the stack.
 */
export async function deleteArea(id: string, db: TendDb = getDb()): Promise<string[]> {
  return db.transaction('rw', [db.areas, db.projects, db.outbox], async () => {
    const current = await db.areas.get(id);
    if (!current) return [];

    const filed = (await db.projects.where('_del').equals(0).toArray()).filter(
      (project) => project.areaId === id,
    );
    for (const project of filed) await writeProjectPatch(project.id, { areaId: '' }, db);

    const deletedAt = nowIso();
    const next = { ...current, deletedAt, updatedAt: deletedAt };
    await db.areas.put({ ...next, ...deriveArea(next) });
    await db.outbox.add(outboxRecord('areas', id, 'delete', { deletedAt }, current.rowVersion));

    return filed.map((project) => project.id);
  });
}

/** Puts an area back, and the projects `deleteArea` moved out of it with it. */
export async function restoreArea(
  id: string,
  filedProjectIds: readonly string[] = [],
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.areas, db.projects, db.outbox], async () => {
    const current = await db.areas.get(id);
    if (!current) return;

    const next = { ...current, deletedAt: null, updatedAt: nowIso() };
    await db.areas.put({ ...next, ...deriveArea(next) });
    await db.outbox.add(
      outboxRecord('areas', id, 'undelete', { deletedAt: null }, current.rowVersion),
    );

    for (const projectId of filedProjectIds) {
      await writeProjectPatch(projectId, { areaId: id }, db);
    }
  });
}

/** Moves an area between two neighbours. Unlogged for the reason `reorderTask`
 *  gives: the gesture is its own undo, and a position in the undo stack would
 *  sit between the edits people actually want back. */
export async function reorderArea(
  id: string,
  prevSortKey: string | null,
  nextSortKey: string | null,
  db: TendDb = getDb(),
): Promise<void> {
  await updateArea(id, { sortKey: rankAmong(prevSortKey, nextSortKey) }, db);
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export type ProjectPatch = Partial<
  Pick<
    Project,
    'name' | 'notes' | 'areaId' | 'status' | 'color' | 'dueDate' | 'sortKey' | 'archivedAt'
  >
>;

/** Writes one project field set. Called inside the caller's transaction, which
 *  is what lets a delete move projects and tasks in the same commit. */
async function writeProjectPatch(
  id: string,
  patch: ProjectPatch,
  db: TendDb,
): Promise<Project | null> {
  const current = await db.projects.get(id);
  if (!current) return null;

  const next = { ...current, ...patch, updatedAt: nowIso() };

  // Stamped locally for the same reason `writeTaskPatch` stamps it: the column
  // is server-owned, so the patch cannot carry it, and the row still has to be
  // able to say when it was finished before the next pull lands. Signed out
  // there is no next pull, and this is the only thing that ever sets it.
  // Cancelled is not done, which is the rule 0020's trigger applies server-side.
  if (patch.status !== undefined && patch.status !== current.status) {
    next.completedAt = patch.status === 'done' ? nowIso() : null;
  }

  await db.projects.put({ ...next, ...deriveProject(next) });
  await db.outbox.add(outboxRecord('projects', id, 'update', { ...patch }, current.rowVersion));
  return current;
}

export async function createProject(
  input: { name: string; color?: string; notes?: string; areaId?: string },
  db: TendDb = getDb(),
): Promise<string> {
  const id = newId();
  await db.transaction('rw', [db.projects, db.outbox], async () => {
    const existing = await db.projects.where('_del').equals(0).toArray();
    const base = {
      id,
      userId: LOCAL_USER_ID,
      areaId: input.areaId ?? '',
      name: input.name,
      notes: input.notes ?? '',
      status: 'active' as const,
      // Rotating on what is already there, so a project quick-add filed with
      // `@kitchen` still gets a dot that tells it apart from the last one.
      color: input.color ?? swatchFor(existing.length),
      dueDate: null,
      completedAt: null,
      sortKey: endRank(existing.map((p) => p.sortKey)),
      archivedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };
    const row: Project = { ...base, ...deriveProject(base) };
    await db.projects.add(row);

    await db.outbox.add(outboxRecord('projects', id, 'insert', toInsertPatch(row), 0));
  });
  return id;
}

/**
 * Finds a project by name or creates it. Quick-add types `@home` faster than
 * anyone picks from a list, and a chip that shows a project without filing the
 * task into it is worse than no chip at all.
 */
export async function ensureProject(name: string, db: TendDb = getDb()): Promise<string> {
  const trimmed = name.trim();
  const existing = await db.projects.where('_del').equals(0).toArray();
  const match = existing.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  if (match) return match.id;
  return createProject({ name: trimmed }, db);
}

export async function updateProject(
  id: string,
  patch: ProjectPatch,
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.projects, db.outbox], async () => {
    await writeProjectPatch(id, patch, db);
  });
}

/**
 * Archives a project, or puts it back.
 *
 * Archiving is the reversible gesture and deleting is not, so this is the one
 * the screen offers first. A finished project keeps its tasks and its history
 * and stops taking up a row.
 */
export async function setProjectArchived(
  id: string,
  archived: boolean,
  db: TendDb = getDb(),
): Promise<void> {
  await updateProject(id, { archivedAt: archived ? nowIso() : null }, db);
}

/**
 * Tombstones a project and files its tasks back into the Inbox.
 *
 * Leaving them pointing at the tombstone would lose them. Inbox is
 * `projectId === ''` read off a compound index, and Today and Upcoming key off
 * the due day, so a dateless task filed to a deleted project would appear in no
 * list at all. Moving them is what keeps "delete the project" from meaning
 * "delete the work".
 *
 * The moves are unlogged, for the reason `reorderTask` gives: an entry in the
 * undo stack that puts a task back into a project that no longer exists is a
 * half-undo. The whole gesture is reversed through `restoreProject` with the ids
 * returned here instead.
 *
 * Subtasks are not touched. A subtask carries `projectId === ''` and takes its
 * project from its parent, so moving the parent moves it.
 */
export interface ProjectDeletion {
  /** Every task moved out, finished ones included, because undo has to put all
   *  of them back. */
  taskIds: string[];
  /** How many of those will actually show up in the Inbox, which lists open work
   *  only. The two numbers differ on any project with history, and it is this
   *  one a message about where the tasks went has to quote. */
  open: number;
}

export async function deleteProject(
  id: string,
  db: TendDb = getDb(),
): Promise<ProjectDeletion> {
  return db.transaction('rw', [db.projects, db.tasks, db.taskTags, db.outbox], async () => {
    const current = await db.projects.get(id);
    if (!current) return { taskIds: [], open: 0 };

    const filed = (await db.tasks.where('projectId').equals(id).toArray()).filter(
      (task) => task._del === 0,
    );
    for (const task of filed) await writeTaskPatch(task.id, { projectId: NO_PROJECT }, db);

    const deletedAt = nowIso();
    const next = { ...current, deletedAt, updatedAt: deletedAt };
    await db.projects.put({ ...next, ...deriveProject(next) });
    await db.outbox.add(outboxRecord('projects', id, 'delete', { deletedAt }, current.rowVersion));

    return {
      taskIds: filed.map((task) => task.id),
      open: filed.filter((task) => task._done === 0).length,
    };
  });
}

/** Puts a project back, and the tasks `deleteProject` sent to the Inbox with it. */
export async function restoreProject(
  id: string,
  filedTaskIds: readonly string[] = [],
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.projects, db.tasks, db.taskTags, db.outbox], async () => {
    const current = await db.projects.get(id);
    if (!current) return;

    const next = { ...current, deletedAt: null, updatedAt: nowIso() };
    await db.projects.put({ ...next, ...deriveProject(next) });
    await db.outbox.add(
      outboxRecord('projects', id, 'undelete', { deletedAt: null }, current.rowVersion),
    );

    for (const taskId of filedTaskIds) await writeTaskPatch(taskId, { projectId: id }, db);
  });
}

/** Moves a project between two neighbours. Unlogged for the same reason
 *  `reorderTask` is: dragging it back is the undo. */
export async function reorderProject(
  id: string,
  prevSortKey: string | null,
  nextSortKey: string | null,
  db: TendDb = getDb(),
): Promise<void> {
  await updateProject(id, { sortKey: rankAmong(prevSortKey, nextSortKey) }, db);
}

// ─── Terms and courses ────────────────────────────────────────────────────────

export async function createTerm(
  input: { name: string; startDate: string; endDate: string },
  db: TendDb = getDb(),
): Promise<string> {
  const id = newId();
  await db.transaction('rw', [db.terms, db.outbox], async () => {
    const existing = await db.terms.where('_del').equals(0).toArray();
    const base = {
      id,
      userId: LOCAL_USER_ID,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      sortKey: endRank(existing.map((t) => t.sortKey)),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };
    const row: Term = { ...base, ...deriveTerm(base) };
    await db.terms.add(row);
    await db.outbox.add(outboxRecord('terms', id, 'insert', toInsertPatch(row), 0));
  });
  return id;
}

export type TermPatch = Partial<Pick<Term, 'name' | 'startDate' | 'endDate' | 'sortKey'>>;

export async function updateTerm(
  id: string,
  patch: TermPatch,
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.terms, db.outbox], async () => {
    const current = await db.terms.get(id);
    if (!current) return;
    const next = { ...current, ...patch, updatedAt: nowIso() };
    await db.terms.put({ ...next, ...deriveTerm(next) });
    await db.outbox.add(outboxRecord('terms', id, 'update', { ...patch }, current.rowVersion));
  });
}

/**
 * Tombstones a term and unfiles the courses in it.
 *
 * Same rule as a project: a course pointing at a tombstone shows under no term,
 * which is a course you cannot find. `restoreTerm` takes the ids back so undo
 * can put them where they were.
 */
export async function deleteTerm(
  id: string,
  db: TendDb = getDb(),
): Promise<{ courseIds: string[] }> {
  return db.transaction('rw', [db.terms, db.courses, db.outbox], async () => {
    const current = await db.terms.get(id);
    if (!current) return { courseIds: [] };

    const filed = (await db.courses.where('termId').equals(id).toArray()).filter(
      (course) => course._del === 0,
    );
    for (const course of filed) await writeCoursePatch(course.id, { termId: '' }, db);

    const deletedAt = nowIso();
    const next = { ...current, deletedAt, updatedAt: deletedAt };
    await db.terms.put({ ...next, ...deriveTerm(next) });
    await db.outbox.add(outboxRecord('terms', id, 'delete', { deletedAt }, current.rowVersion));

    return { courseIds: filed.map((course) => course.id) };
  });
}

export async function restoreTerm(
  id: string,
  courseIds: readonly string[] = [],
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.terms, db.courses, db.outbox], async () => {
    const current = await db.terms.get(id);
    if (!current) return;
    const next = { ...current, deletedAt: null, updatedAt: nowIso() };
    await db.terms.put({ ...next, ...deriveTerm(next) });
    await db.outbox.add(
      outboxRecord('terms', id, 'undelete', { deletedAt: null }, current.rowVersion),
    );
    for (const courseId of courseIds) await writeCoursePatch(courseId, { termId: id }, db);
  });
}

export async function createCourse(
  input: {
    code: string;
    name?: string;
    termId?: string;
    color?: string;
    creditHours?: number;
    instructor?: string;
    meetings?: CourseMeeting[];
  },
  db: TendDb = getDb(),
): Promise<string> {
  const id = newId();
  await db.transaction('rw', [db.courses, db.outbox], async () => {
    const existing = await db.courses.where('_del').equals(0).toArray();
    const base = {
      id,
      userId: LOCAL_USER_ID,
      termId: input.termId ?? '',
      code: input.code,
      name: input.name ?? '',
      // Rotating on what is already there, so a new course gets a colour that
      // tells it apart from the last one, the way a project does.
      color: input.color ?? swatchFor(existing.length),
      creditHours: input.creditHours ?? 3,
      instructor: input.instructor ?? '',
      meetings: input.meetings ?? [],
      gradeScale: [],
      status: 'active' as const,
      notes: '',
      sortKey: endRank(existing.map((c) => c.sortKey)),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };
    const row: Course = { ...base, ...deriveCourse(base) };
    await db.courses.add(row);
    await db.outbox.add(outboxRecord('courses', id, 'insert', toInsertPatch(row), 0));
  });
  return id;
}

export type CoursePatch = Partial<
  Pick<
    Course,
    | 'termId'
    | 'code'
    | 'name'
    | 'color'
    | 'creditHours'
    | 'instructor'
    | 'meetings'
    | 'gradeScale'
    | 'status'
    | 'notes'
    | 'sortKey'
  >
>;

/** The write half, with no outbox record of its own suppressed. Used by the term
 *  delete path, which has to touch several courses inside one transaction. */
async function writeCoursePatch(
  id: string,
  patch: CoursePatch,
  db: TendDb,
): Promise<void> {
  const current = await db.courses.get(id);
  if (!current) return;
  const next = { ...current, ...patch, updatedAt: nowIso() };
  await db.courses.put({ ...next, ...deriveCourse(next) });
  await db.outbox.add(outboxRecord('courses', id, 'update', { ...patch }, current.rowVersion));
}

export async function updateCourse(
  id: string,
  patch: CoursePatch,
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.courses, db.outbox], async () => {
    await writeCoursePatch(id, patch, db);
  });
}

/**
 * Tombstones a course and files its tasks back out of it.
 *
 * The same rule `deleteProject` follows, and for the same reason: a task
 * pointing at a tombstoned course appears under no course, so the work would be
 * findable only through a list that no longer mentions it. The component link
 * goes too, since a weight belongs to the course that defined it.
 */
export async function deleteCourse(
  id: string,
  db: TendDb = getDb(),
): Promise<{ taskIds: string[]; open: number }> {
  return db.transaction('rw', [db.courses, db.tasks, db.taskTags, db.outbox], async () => {
    const current = await db.courses.get(id);
    if (!current) return { taskIds: [], open: 0 };

    const filed = (await db.tasks.where('courseId').equals(id).toArray()).filter(
      (task) => task._del === 0,
    );
    for (const task of filed) {
      await writeTaskPatch(task.id, { courseId: NO_COURSE, componentId: NO_COMPONENT }, db);
    }

    const deletedAt = nowIso();
    const next = { ...current, deletedAt, updatedAt: deletedAt };
    await db.courses.put({ ...next, ...deriveCourse(next) });
    await db.outbox.add(outboxRecord('courses', id, 'delete', { deletedAt }, current.rowVersion));

    return {
      taskIds: filed.map((task) => task.id),
      open: filed.filter((task) => task._done === 0).length,
    };
  });
}

export async function restoreCourse(
  id: string,
  filedTaskIds: readonly string[] = [],
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.courses, db.tasks, db.taskTags, db.outbox], async () => {
    const current = await db.courses.get(id);
    if (!current) return;
    const next = { ...current, deletedAt: null, updatedAt: nowIso() };
    await db.courses.put({ ...next, ...deriveCourse(next) });
    await db.outbox.add(
      outboxRecord('courses', id, 'undelete', { deletedAt: null }, current.rowVersion),
    );
    for (const taskId of filedTaskIds) await writeTaskPatch(taskId, { courseId: id }, db);
  });
}

export async function reorderCourse(
  id: string,
  prevSortKey: string | null,
  nextSortKey: string | null,
  db: TendDb = getDb(),
): Promise<void> {
  const sortKey = rankAmong(prevSortKey, nextSortKey);
  await db.transaction('rw', [db.courses, db.outbox], async () => {
    await writeCoursePatch(id, { sortKey }, db);
  });
}

// ─── Grade components ─────────────────────────────────────────────────────────

export async function createComponent(
  input: { courseId: string; name: string; weight?: number; dropLowest?: number },
  db: TendDb = getDb(),
): Promise<string> {
  const id = newId();
  await db.transaction('rw', [db.courseComponents, db.outbox], async () => {
    const existing = await db.courseComponents
      .where('[_del+courseId+sortKey]')
      .between([0, input.courseId, ''], [0, input.courseId, '\uffff'], true, true)
      .toArray();

    const base = {
      id,
      userId: LOCAL_USER_ID,
      courseId: input.courseId,
      name: input.name,
      weight: input.weight ?? 0,
      dropLowest: input.dropLowest ?? 0,
      sortKey: endRank(existing.map((c) => c.sortKey)),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };
    const row: CourseComponent = { ...base, ...deriveCourseComponent(base) };
    await db.courseComponents.add(row);
    await db.outbox.add(outboxRecord('courseComponents', id, 'insert', toInsertPatch(row), 0));
  });
  return id;
}

export type ComponentPatch = Partial<
  Pick<CourseComponent, 'name' | 'weight' | 'dropLowest' | 'sortKey'>
>;

export async function updateComponent(
  id: string,
  patch: ComponentPatch,
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.courseComponents, db.outbox], async () => {
    const current = await db.courseComponents.get(id);
    if (!current) return;
    const next = { ...current, ...patch, updatedAt: nowIso() };
    await db.courseComponents.put({ ...next, ...deriveCourseComponent(next) });
    await db.outbox.add(
      outboxRecord('courseComponents', id, 'update', { ...patch }, current.rowVersion),
    );
  });
}

/**
 * Tombstones a component and unfiles the work counted under it.
 *
 * The same rule a course and a project follow. A task pointing at a tombstoned
 * component would keep its points and count toward a weight that no longer
 * exists, which is the one way a grade projection can be quietly wrong.
 */
export async function deleteComponent(
  id: string,
  db: TendDb = getDb(),
): Promise<{ taskIds: string[] }> {
  return db.transaction(
    'rw',
    [db.courseComponents, db.tasks, db.taskTags, db.outbox],
    async () => {
      const current = await db.courseComponents.get(id);
      if (!current) return { taskIds: [] };

      const filed = (await db.tasks.where('componentId').equals(id).toArray()).filter(
        (task) => task._del === 0,
      );
      for (const task of filed) {
        await writeTaskPatch(task.id, { componentId: NO_COMPONENT }, db);
      }

      const deletedAt = nowIso();
      const next = { ...current, deletedAt, updatedAt: deletedAt };
      await db.courseComponents.put({ ...next, ...deriveCourseComponent(next) });
      await db.outbox.add(
        outboxRecord('courseComponents', id, 'delete', { deletedAt }, current.rowVersion),
      );

      return { taskIds: filed.map((task) => task.id) };
    },
  );
}

export async function restoreComponent(
  id: string,
  filedTaskIds: readonly string[] = [],
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction(
    'rw',
    [db.courseComponents, db.tasks, db.taskTags, db.outbox],
    async () => {
      const current = await db.courseComponents.get(id);
      if (!current) return;
      const next = { ...current, deletedAt: null, updatedAt: nowIso() };
      await db.courseComponents.put({ ...next, ...deriveCourseComponent(next) });
      await db.outbox.add(
        outboxRecord('courseComponents', id, 'undelete', { deletedAt: null }, current.rowVersion),
      );
      for (const taskId of filedTaskIds) await writeTaskPatch(taskId, { componentId: id }, db);
    },
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * Everything a person can change. The server owns the rest, and
 * `emailTokenVersion` is on that list: it exists to revoke unsubscribe links, so
 * a client that could set it could un-revoke its own.
 */
export type PrefsPatch = Partial<
  Omit<Prefs, 'id' | 'rowVersion' | 'updatedAt' | 'emailTokenVersion'>
>;

/**
 * Changes settings, which is always an update.
 *
 * The row is created at signup, so the server refuses an insert for it. A device
 * that has never pulled still has settings to show, from the defaults, and
 * writing over those is what lets the settings page work before the first sync.
 */
export async function updatePrefs(patch: PrefsPatch, db: TendDb = getDb()): Promise<void> {
  await db.transaction('rw', [db.prefs, db.outbox], async () => {
    const current = (await db.prefs.get(PREFS_ID)) ?? DEFAULT_PREFS;
    await db.prefs.put({ ...current, ...patch, updatedAt: nowIso() });
    await db.outbox.add(
      outboxRecord('prefs', PREFS_ID, 'update', { ...patch }, current.rowVersion),
    );
  });
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export async function createTag(
  input: { name: string; color?: string },
  db: TendDb = getDb(),
): Promise<string> {
  const id = newId();
  await db.transaction('rw', [db.tags, db.outbox], async () => {
    const existing = await db.tags.where('_del').equals(0).toArray();
    const base = {
      id,
      userId: LOCAL_USER_ID,
      name: input.name,
      color: input.color ?? '#C29B72',
      sortKey: endRank(existing.map((t) => t.sortKey)),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      rowVersion: 0,
    };
    const row: Tag = { ...base, ...deriveTag(base) };
    await db.tags.add(row);

    await db.outbox.add(outboxRecord('tags', id, 'insert', toInsertPatch(row), 0));
  });
  return id;
}

/**
 * Renames a tag, or reports why it cannot.
 *
 * Postgres holds a case-insensitive unique index over live tag names
 * (`tags_user_name_live_idx`), so a clash is not a matter of taste: the write
 * would go out, the push would fail, and the rename would be undone by the
 * server hours later. Checked here instead, while the person is still looking
 * at the field.
 */
export async function renameTag(
  id: string,
  name: string,
  db: TendDb = getDb(),
): Promise<'ok' | 'empty' | 'taken'> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'empty';

  return db.transaction('rw', [db.tags, db.outbox], async () => {
    const current = await db.tags.get(id);
    if (!current || current._del === 1) return 'empty';
    if (current.name === trimmed) return 'ok';

    const live = await db.tags.where('_del').equals(0).toArray();
    const clash = live.find(
      (tag) => tag.id !== id && tag.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (clash) return 'taken';

    const next = { ...current, name: trimmed, updatedAt: nowIso() };
    await db.tags.put({ ...next, ...deriveTag(next) });
    await db.outbox.add(
      outboxRecord('tags', id, 'update', { name: trimmed }, current.rowVersion),
    );
    return 'ok';
  });
}

/**
 * Deletes a tag and takes it off every task that carried it.
 *
 * The links have to go with it. A task left pointing at a tombstone shows a tag
 * with no name and cannot be untagged, which is the same trap `deleteProject`
 * avoids by filing its tasks back into the Inbox. Returns the tasks it touched,
 * so the toast can say how many and undo can put them back.
 */
export async function deleteTag(id: string, db: TendDb = getDb()): Promise<string[]> {
  return db.transaction('rw', [db.tags, db.tasks, db.taskTags, db.outbox], async () => {
    const current = await db.tags.get(id);
    if (!current || current._del === 1) return [];

    const links = await db.taskTags.where('tagId').equals(id).toArray();
    const taskIds = [...new Set(links.map((link) => link.taskId))];
    for (const taskId of taskIds) {
      const remaining = (await db.taskTags.where('taskId').equals(taskId).toArray())
        .map((link) => link.tagId)
        .filter((tagId) => tagId !== id);
      await setTaskTags(taskId, remaining, db);
    }

    const deletedAt = nowIso();
    const next = { ...current, deletedAt, updatedAt: deletedAt };
    await db.tags.put({ ...next, ...deriveTag(next) });
    await db.outbox.add(outboxRecord('tags', id, 'delete', { deletedAt }, current.rowVersion));

    return taskIds;
  });
}

/**
 * Puts a tag back on the tasks `deleteTag` took it off.
 *
 * The name may have been taken in the meantime: delete `#work`, type
 * `Buy milk #work` before the toast expires, and `ensureTag` makes a second one
 * because the first is no longer live. An undelete then is not a write that
 * fails, it is a **fatal push**. `tags_user_name_live_idx` is a partial unique
 * index, the `delete`/`undelete` arm of `sync_push` is the one arm with no
 * exception block, so `23505` raises out of the whole function, and
 * `failBatch` deadletters every mutation claimed alongside it: task edits,
 * completions and notes, gone from the server for good.
 *
 * So a clash relinks the tasks to the tag that holds the name now and leaves
 * the tombstone alone. The person asked for those tasks to carry `#work` again,
 * and they do.
 */
export type TagRestore = 'ok' | 'merged' | 'gone';

export async function restoreTag(
  id: string,
  taskIds: readonly string[] = [],
  db: TendDb = getDb(),
): Promise<TagRestore> {
  return db.transaction('rw', [db.tags, db.tasks, db.taskTags, db.outbox], async () => {
    const current = await db.tags.get(id);
    if (!current) return 'gone';

    const live = await db.tags.where('_del').equals(0).toArray();
    const holder = live.find(
      (tag) => tag.id !== id && tag.name.toLowerCase() === current.name.toLowerCase(),
    );
    const wanted = holder?.id ?? id;

    if (!holder) {
      const next = { ...current, deletedAt: null, updatedAt: nowIso() };
      await db.tags.put({ ...next, ...deriveTag(next) });
      await db.outbox.add(
        outboxRecord('tags', id, 'undelete', { deletedAt: null }, current.rowVersion),
      );
    }

    for (const taskId of taskIds) {
      const held = (await db.taskTags.where('taskId').equals(taskId).toArray()).map(
        (link) => link.tagId,
      );
      if (!held.includes(wanted)) await setTaskTags(taskId, [...held, wanted], db);
    }

    return holder ? 'merged' : 'ok';
  });
}

/**
 * Finds a tag by name or creates it. Quick-add types `#work` faster than anyone
 * manages a tag list, so the parser needs this.
 */
export async function ensureTag(name: string, db: TendDb = getDb()): Promise<string> {
  const trimmed = name.trim();
  const existing = await db.tags.where('_del').equals(0).toArray();
  const match = existing.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  if (match) return match.id;
  return createTag({ name: trimmed }, db);
}

// Re-exported so callers do not reach into the sentinel module directly.
export { NO_DUE_DAY, NO_PARENT, NO_PROJECT, isClosed };
