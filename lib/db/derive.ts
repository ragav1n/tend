import {
  NO_DUE_DAY,
  type ActivityEntry,
  type Area,
  type DerivedTaskFields,
  type FocusSession,
  type Project,
  type SavedView,
  type Tag,
  type Task,
  type TaskSeries,
} from './types';

/**
 * The only place derived index fields are computed.
 *
 * Two code paths write local rows: the optimistic path in `mutations.ts` and the
 * server-apply path in the sync engine. If each derived its own index fields the
 * two would drift, and the symptom would be a task that is invisible in Today
 * but present in search. Both call in here instead.
 *
 * Everything here is pure, so it is cheap to test and safe to run inside a Dexie
 * transaction.
 */

/** Strips diacritics and case so "Café" matches a search for "cafe". */
function foldText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const WORD_SPLIT = /[^a-z0-9]+/;

/**
 * Search tokens for the multiEntry `_words` index. Dexie can then answer
 * `where('_words').startsWithIgnoreCase(q)` with an index scan, which covers
 * prefix search without pulling in a search library.
 *
 * Notes are truncated because a long markdown note would otherwise dominate the
 * index, and matches deep inside a note body are rarely what someone means.
 */
export function tokenize(title: string, notes = ''): string[] {
  const source = `${title} ${notes.slice(0, 2000)}`;
  const seen = new Set<string>();
  for (const raw of foldText(source).split(WORD_SPLIT)) {
    // Single characters match nearly everything, so they cost index space and
    // return noise.
    if (raw.length > 1) seen.add(raw);
  }
  return [...seen];
}

/** A task leaves the open lists when it is done or cancelled. */
export function isClosed(status: Task['status']): boolean {
  return status === 'done' || status === 'cancelled';
}

/**
 * Derived fields for one task. `tagIds` is passed in because it lives in the
 * `taskTags` join table, and the caller already has it inside the transaction.
 */
export function deriveTask(
  task: Omit<Task, keyof DerivedTaskFields>,
  tagIds: string[] = [],
): DerivedTaskFields {
  return {
    _del: task.deletedAt ? 1 : 0,
    _done: isClosed(task.status) ? 1 : 0,
    // The sentinel keeps "no due date" inside the same range scan as real dates
    // instead of needing its own query, and it sorts last, which is where a
    // someday task belongs.
    _dueDay: task.dueDate ?? NO_DUE_DAY,
    _plannedDay: task.plannedFor ?? NO_DUE_DAY,
    _tagIds: tagIds,
    _words: tokenize(task.title, task.notes),
  };
}

/** Applies derived fields to a task row in place and returns it. */
export function withDerivedTask(
  task: Omit<Task, keyof DerivedTaskFields> & Partial<DerivedTaskFields>,
  tagIds: string[] = [],
): Task {
  return { ...task, ...deriveTask(task, tagIds) } as Task;
}

export function deriveProject(
  project: Omit<Project, '_del' | '_archived'>,
): Pick<Project, '_del' | '_archived'> {
  return {
    _del: project.deletedAt ? 1 : 0,
    _archived: project.archivedAt ? 1 : 0,
  };
}

export function deriveArea(area: Omit<Area, '_del'>): Pick<Area, '_del'> {
  return { _del: area.deletedAt ? 1 : 0 };
}

export function deriveTag(tag: Omit<Tag, '_del'>): Pick<Tag, '_del'> {
  return { _del: tag.deletedAt ? 1 : 0 };
}

export function deriveSeries(series: Omit<TaskSeries, '_del'>): Pick<TaskSeries, '_del'> {
  return { _del: series.deletedAt ? 1 : 0 };
}

export function deriveFocusSession(
  session: Omit<FocusSession, '_del'>,
): Pick<FocusSession, '_del'> {
  return { _del: session.deletedAt ? 1 : 0 };
}

export function deriveSavedView(view: Omit<SavedView, '_del'>): Pick<SavedView, '_del'> {
  return { _del: view.deletedAt ? 1 : 0 };
}

/** `_undone` exists because IndexedDB cannot index a boolean or a null, and the
 *  undo stack's only question is which entries still stand. */
export function deriveActivity(
  entry: Omit<ActivityEntry, '_del' | '_undone'>,
): Pick<ActivityEntry, '_del' | '_undone'> {
  return { _del: entry.deletedAt ? 1 : 0, _undone: entry.undoneAt ? 1 : 0 };
}
