import {
  addDays,
  daysBetween,
  nextOccurrence,
  type RecurrenceRule,
} from '@/lib/recurrence';
import { getDb, LOCAL_USER_ID, type TendDb } from './client';
import {
  deriveFocusSession,
  deriveProject,
  deriveSeries,
  deriveTag,
  deriveTask,
  isClosed,
} from './derive';
import { newBatchId, newId, newMutationId } from './ids';
import { DEFAULT_PREFS, PREFS_ID } from './prefs';
import { today } from './queries';
import { rankAfter, rankBefore, rankBetween } from './rank';
import { fromRule, toRule } from './series';
import {
  NO_DUE_DAY,
  NO_PARENT,
  NO_PROJECT,
  type EntityTable,
  type FocusSession,
  type MutationOp,
  type OutboxRecord,
  type Prefs,
  type Priority,
  type Project,
  type Tag,
  type Task,
  type TaskSeries,
  type TaskStatus,
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
  'updatedAt',
  'rowVersion',
  'completedAt',
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

/** Rank at the end of a list, given the rows already in it. */
function endRank(existing: readonly string[]): string {
  if (existing.length === 0) return rankAfter(null);
  const last = [...existing].sort()[existing.length - 1];
  return rankAfter(last ?? null);
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function createTask(input: NewTaskInput, db: TendDb = getDb()): Promise<string> {
  const id = newId();
  const parentTaskId = input.parentTaskId ?? NO_PARENT;
  const tagIds = input.tagIds ?? [];
  const batchId = tagIds.length > 0 ? newBatchId() : null;

  await db.transaction('rw', [db.tasks, db.taskTags, db.outbox], async () => {
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
      cancelReason: null,
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
  });

  return id;
}

export async function updateTask(
  id: string,
  patch: TaskPatch,
  db: TendDb = getDb(),
): Promise<void> {
  await db.transaction('rw', [db.tasks, db.taskTags, db.outbox], async () => {
    const current = await db.tasks.get(id);
    if (!current) return;

    const next = { ...current, ...patch, updatedAt: nowIso() };

    // completedAt is server-derived, but the optimistic row still needs a value
    // so the UI can show "done 2 minutes ago" before the next pull lands.
    if (patch.status !== undefined && patch.status !== current.status) {
      next.completedAt = patch.status === 'done' ? nowIso() : null;
    }
    if (patch.parentTaskId !== undefined) {
      next.depth = patch.parentTaskId === NO_PARENT ? 0 : 1;
    }

    const tagIds = (await db.taskTags.where('taskId').equals(id).toArray()).map((t) => t.tagId);
    const row: Task = { ...next, ...deriveTask(next, tagIds) };
    await db.tasks.put(row);

    await db.outbox.add(outboxRecord('tasks', id, 'update', { ...patch }, current.rowVersion));
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
  let created: string | null = null;

  await db.transaction('rw', [db.tasks, db.taskTags, db.taskSeries, db.outbox], async () => {
    // Read before the write, so the clone copies the status the task had rather
    // than the 'done' it is about to get.
    const before = await db.tasks.get(id);
    if (!before) return;

    await updateTask(id, { status: done ? 'done' : 'active' }, db);
    if (!done || before.seriesId === '') return;

    created = await materializeNext(before, db);
  });

  return created;
}

/**
 * Clones the completed occurrence forward.
 *
 * The clone is what makes the series row hold nothing but the rule: there is no
 * second set of template columns that can drift out of step with the task the
 * user actually edits.
 */
async function materializeNext(completed: Task, db: TendDb): Promise<string | null> {
  const series = await db.taskSeries.get(completed.seriesId);
  if (!series || series._del === 1) return null;

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

  if (result.kind === 'ended') return null;

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
    cancelReason: null,
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

  return id;
}

/** Soft delete. The row keeps its content so restore is just another field write. */
export async function deleteTask(id: string, db: TendDb = getDb()): Promise<void> {
  await db.transaction('rw', [db.tasks, db.taskTags, db.outbox], async () => {
    const current = await db.tasks.get(id);
    if (!current) return;

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
  });
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
  await db.transaction('rw', [db.tasks, db.taskTags, db.outbox], async () => {
    const current = await db.tasks.get(id);
    if (!current) return;

    const children = (await db.tasks.where('parentTaskId').equals(id).toArray()).filter(
      (t) => t.deletedAt !== null && t.deletedAt === current.deletedAt,
    );

    for (const row of [current, ...children]) {
      const next = { ...row, deletedAt: null, updatedAt: nowIso() };
      const tagIds = (await db.taskTags.where('taskId').equals(row.id).toArray()).map(
        (t) => t.tagId,
      );
      await db.tasks.put({ ...next, ...deriveTask(next, tagIds) });
      await db.outbox.add(
        outboxRecord('tasks', row.id, 'undelete', { deletedAt: null }, row.rowVersion),
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
  const sortKey =
    prevSortKey === null && nextSortKey === null
      ? rankAfter(null)
      : prevSortKey === null
        ? rankBefore(nextSortKey)
        : nextSortKey === null
          ? rankAfter(prevSortKey)
          : rankBetween(prevSortKey, nextSortKey);

  await updateTask(id, { [field]: sortKey } as TaskPatch, db);
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
    await updateTask(
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

    await updateTask(taskId, { seriesId: '', occurrenceDate: null, occurrenceSeq: null }, db);
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

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function createProject(
  input: { name: string; color?: string; notes?: string },
  db: TendDb = getDb(),
): Promise<string> {
  const id = newId();
  await db.transaction('rw', [db.projects, db.outbox], async () => {
    const existing = await db.projects.where('_del').equals(0).toArray();
    const base = {
      id,
      userId: LOCAL_USER_ID,
      areaId: '',
      name: input.name,
      notes: input.notes ?? '',
      status: 'active' as const,
      color: input.color ?? '#C29B72',
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
