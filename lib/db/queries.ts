import { getDb, type TendDb } from './client';
import { compareRank } from './rank';
import {
  NO_DUE_DAY,
  NO_PARENT,
  NO_PROJECT,
  type FocusSession,
  type Instant,
  type PlainDate,
  type Project,
  type SavedView,
  type Tag,
  type Task,
  type TaskSeries,
} from './types';

/**
 * Hot-path reads.
 *
 * Every query here is index-bound and bounded. A `table.toArray()` on tasks is
 * banned: it deserializes the whole store on the main thread, which is exactly
 * the jank the animation budget cannot absorb.
 *
 * The `'￿'` upper bounds are the standard IndexedDB trick for "any string",
 * since it sorts above every character we ever write into a sort key.
 */

/** Sorts above every character that appears in a sort key or a date. */
const MAX_STR = '￿';

/** Local calendar day as `YYYY-MM-DD`. Uses the device zone, which matches the
 *  wall-clock semantics of `dueDate`. */
export function today(now = new Date()): PlainDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: PlainDate, days: number): PlainDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // Constructed in UTC so the arithmetic cannot be shifted by a DST transition
  // in the local zone. These are calendar dates, not instants.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Overdue plus anything due today. One range scan from the beginning of time to
 * the end of today over `[_del+_done+_dueDay+sortKey]`.
 */
export async function dueThrough(day: PlainDate, db: TendDb = getDb()): Promise<Task[]> {
  return db.tasks
    .where('[_del+_done+_dueDay+sortKey]')
    .between([0, 0, '', ''], [0, 0, day, MAX_STR], true, true)
    .toArray();
}

/** Tasks the user put on a specific day's plan, in their hand-arranged order. */
export async function plannedFor(day: PlainDate, db: TendDb = getDb()): Promise<Task[]> {
  return db.tasks
    .where('[_del+_done+_plannedDay+plannedSortKey]')
    .between([0, 0, day, ''], [0, 0, day, MAX_STR], true, true)
    .toArray();
}

/**
 * The Today list: overdue, due today, and anything explicitly planned for today.
 *
 * Two index scans merged by id rather than one scan with a filter, because a
 * filter would have to walk every open task. Subtasks are excluded: they render
 * underneath their parent, so surfacing them at top level would show the same
 * work twice.
 */
export async function todayList(day = today(), db: TendDb = getDb()): Promise<Task[]> {
  const [due, planned] = await Promise.all([dueThrough(day, db), plannedFor(day, db)]);

  const byId = new Map<string, Task>();
  for (const t of [...due, ...planned]) {
    if (t.parentTaskId !== NO_PARENT) continue;
    byId.set(t.id, t);
  }

  // Overdue first, then today's work. Inside each group, the user's order.
  const rows = [...byId.values()];
  rows.sort((a, b) => {
    const aOver = a._dueDay < day && a._dueDay !== NO_DUE_DAY ? 0 : 1;
    const bOver = b._dueDay < day && b._dueDay !== NO_DUE_DAY ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    return compareRank(a, b);
  });
  return rows;
}

/** The next `days` worth of dated work, excluding today. */
export async function upcomingList(
  day = today(),
  days = 30,
  db: TendDb = getDb(),
): Promise<Task[]> {
  const from = addDays(day, 1);
  const to = addDays(day, days);
  const rows = await db.tasks
    .where('[_del+_done+_dueDay+sortKey]')
    .between([0, 0, from, ''], [0, 0, to, MAX_STR], true, true)
    .toArray();
  return rows.filter((t) => t.parentTaskId === NO_PARENT);
}

/**
 * Everything dated inside a window, open and closed, for the calendar grid.
 *
 * Two scans rather than one because `_done` sits above `_dueDay` in the index,
 * so a single range would have to walk both halves of the store. Completed work
 * stays in the answer: a month with nothing on the days already lived through
 * reads as a broken calendar rather than a finished week.
 */
export async function dueBetween(
  from: PlainDate,
  to: PlainDate,
  db: TendDb = getDb(),
): Promise<Task[]> {
  const [open, closed] = await Promise.all([
    db.tasks
      .where('[_del+_done+_dueDay+sortKey]')
      .between([0, 0, from, ''], [0, 0, to, MAX_STR], true, true)
      .toArray(),
    db.tasks
      .where('[_del+_done+_dueDay+sortKey]')
      .between([0, 1, from, ''], [0, 1, to, MAX_STR], true, true)
      .toArray(),
  ]);

  return [...open, ...closed]
    .filter((t) => t.parentTaskId === NO_PARENT)
    .sort((a, b) => (a._dueDay === b._dueDay ? compareRank(a, b) : a._dueDay < b._dueDay ? -1 : 1));
}

/**
 * Every open top-level task, in the user's order. The board reads this.
 *
 * One scan across the whole due-day range rather than a per-column query, since
 * the board shows all four status columns at once and four scans would read the
 * same rows anyway. Capped: past a few hundred open tasks the board is not the
 * view that helps, and an unbounded read is what the hot-path rule forbids.
 */
export async function openTasks(limit = 500, db: TendDb = getDb()): Promise<Task[]> {
  const rows = await db.tasks
    .where('[_del+_done+_dueDay+sortKey]')
    .between([0, 0, '', ''], [0, 0, NO_DUE_DAY, MAX_STR], true, true)
    .limit(limit)
    .toArray();
  return rows.filter((t) => t.parentTaskId === NO_PARENT).sort(compareRank);
}

/** Unfiled top-level tasks, which is what Inbox means. */
export async function inboxList(db: TendDb = getDb()): Promise<Task[]> {
  const rows = await db.tasks
    .where('[_del+projectId+_done+sortKey]')
    .between([0, NO_PROJECT, 0, ''], [0, NO_PROJECT, 0, MAX_STR], true, true)
    .toArray();
  return rows.filter((t) => t.parentTaskId === NO_PARENT).sort(compareRank);
}

/** Dateless tasks, the "no commitment yet" pile. */
export async function somedayList(db: TendDb = getDb()): Promise<Task[]> {
  const rows = await db.tasks
    .where('[_del+_done+_dueDay+sortKey]')
    .between([0, 0, NO_DUE_DAY, ''], [0, 0, NO_DUE_DAY, MAX_STR], true, true)
    .toArray();
  return rows.filter((t) => t.parentTaskId === NO_PARENT);
}

export async function projectList(projectId: string, db: TendDb = getDb()): Promise<Task[]> {
  const rows = await db.tasks
    .where('[_del+projectId+_done+sortKey]')
    .between([0, projectId, 0, ''], [0, projectId, 0, MAX_STR], true, true)
    .toArray();
  return rows.filter((t) => t.parentTaskId === NO_PARENT).sort(compareRank);
}

export async function subtasksOf(taskId: string, db: TendDb = getDb()): Promise<Task[]> {
  return db.tasks
    .where('[_del+parentTaskId+sortKey]')
    .between([0, taskId, ''], [0, taskId, MAX_STR], true, true)
    .toArray();
}

/** One task by id. Undefined once it is hard-deleted or never existed. */
export async function taskById(id: string, db: TendDb = getDb()): Promise<Task | undefined> {
  return db.tasks.get(id);
}

/**
 * A handful of tasks by id.
 *
 * For a view holding references rather than a list: the focus log points at
 * tasks from any list, and looking their titles up in whatever list happens to
 * be on screen reports "no task" for half of them.
 */
export async function tasksByIds(ids: readonly string[], db: TendDb = getDb()): Promise<Task[]> {
  if (ids.length === 0) return [];
  const rows = await db.tasks.bulkGet([...ids]);
  return rows.filter((t): t is Task => t !== undefined);
}

/** The rule a task repeats by. Undefined for an empty id or a tombstoned row,
 *  so a caller never has to check both. */
export async function seriesById(
  seriesId: string,
  db: TendDb = getDb(),
): Promise<TaskSeries | undefined> {
  if (seriesId === '') return undefined;
  const series = await db.taskSeries.get(seriesId);
  return series && series._del === 0 ? series : undefined;
}

/** Every live project, in the user's order. Small enough to read whole. */
export async function projectOptions(db: TendDb = getDb()): Promise<Project[]> {
  const rows = await db.projects
    .where('[_del+_archived+sortKey]')
    .between([0, 0, ''], [0, 0, MAX_STR], true, true)
    .toArray();
  return rows.sort(compareRank);
}

/** Every live tag, alphabetical. Also small enough to read whole. */
export async function tagOptions(db: TendDb = getDb()): Promise<Tag[]> {
  return db.tags.where('[_del+name]').between([0, ''], [0, MAX_STR], true, true).toArray();
}

/** Tag filter, served by the multiEntry `_tagIds` index. */
export async function taggedWith(tagId: string, db: TendDb = getDb()): Promise<Task[]> {
  const rows = await db.tasks.where('_tagIds').equals(tagId).toArray();
  return rows.filter((t) => t._del === 0 && t._done === 0).sort(compareRank);
}

/**
 * Prefix search over the multiEntry `_words` index.
 *
 * Bounded at 50 because this runs on every keystroke. A multi-word query
 * intersects per-term result sets, so "buy milk" beats either term alone.
 */
export async function searchTasks(
  query: string,
  limit = 50,
  db: TendDb = getDb(),
): Promise<Task[]> {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  if (terms.length === 0) return [];

  const sets = await Promise.all(
    terms.map((term) =>
      db.tasks.where('_words').startsWith(term).limit(500).primaryKeys(),
    ),
  );

  let ids = new Set(sets[0] ?? []);
  for (const next of sets.slice(1)) {
    const other = new Set(next);
    ids = new Set([...ids].filter((id) => other.has(id)));
  }
  if (ids.size === 0) return [];

  const rows = await db.tasks.bulkGet([...ids].slice(0, limit * 2));
  return rows
    .filter((t): t is Task => t !== undefined && t._del === 0)
    .sort(compareRank)
    .slice(0, limit);
}

/** Completed work, newest first. The Logbook. */
export async function logbook(limit = 100, db: TendDb = getDb()): Promise<Task[]> {
  return db.tasks
    .where('[_del+_done+completedAt]')
    .between([0, 1, ''], [0, 1, MAX_STR], true, true)
    .reverse()
    .limit(limit)
    .toArray();
}

/**
 * Tasks completed inside a window, oldest first.
 *
 * Bounds are instants because `completedAt` is one. A cancelled task never
 * appears: it carries no completion instant, so the index skips it, which is the
 * right answer for a screen about what got done.
 */
export async function completedBetween(
  from: Instant,
  to: Instant,
  db: TendDb = getDb(),
): Promise<Task[]> {
  return db.tasks
    .where('[_del+_done+completedAt]')
    .between([0, 1, from], [0, 1, to], true, true)
    .toArray();
}

/** Open work whose due date has already passed. */
export async function overdueList(day = today(), db: TendDb = getDb()): Promise<Task[]> {
  const rows = await dueThrough(addDays(day, -1), db);
  return rows.filter((t) => t.parentTaskId === NO_PARENT).sort(compareRank);
}

// ─── Focus ────────────────────────────────────────────────────────────────────

/** Sessions that began inside a window, oldest first. Both bounds are instants. */
export async function focusBetween(
  from: Instant,
  to: Instant,
  db: TendDb = getDb(),
): Promise<FocusSession[]> {
  return db.focusSessions
    .where('[_del+startedAt]')
    .between([0, from], [0, to], true, true)
    .toArray();
}

/** Seconds focused inside a window. */
export function focusSeconds(sessions: readonly FocusSession[]): number {
  return sessions.reduce((total, session) => total + session.focusedSeconds, 0);
}

/**
 * Sessions still marked running.
 *
 * A tab that dies mid-session leaves one behind, and it stays open until
 * something closes it. Bounded by the window rather than by a scan of the whole
 * log, since anything older than that is already closed or lost.
 */
export async function unfinishedFocus(
  since: Instant,
  db: TendDb = getDb(),
): Promise<FocusSession[]> {
  const rows = await focusBetween(since, MAX_STR, db);
  return rows.filter((session) => session.endedAt === null);
}

/** Counts for the sidebar badges. Uses key-only counts, so no rows deserialize. */
export async function sidebarCounts(day = today(), db: TendDb = getDb()) {
  const [todayRows, inbox, upcoming] = await Promise.all([
    todayList(day, db),
    db.tasks
      .where('[_del+projectId+_done+sortKey]')
      .between([0, NO_PROJECT, 0, ''], [0, NO_PROJECT, 0, MAX_STR], true, true)
      .count(),
    db.tasks
      .where('[_del+_done+_dueDay+sortKey]')
      .between([0, 0, addDays(day, 1), ''], [0, 0, addDays(day, 30), MAX_STR], true, true)
      .count(),
  ]);

  const overdue = todayRows.filter((t) => t._dueDay < day && t._dueDay !== NO_DUE_DAY).length;
  return { today: todayRows.length, overdue, inbox, upcoming };
}

/** Completed versus total for today, which drives the progress ring. */
export async function todayProgress(day = today(), db: TendDb = getDb()) {
  const open = await todayList(day, db);
  const closed = await db.tasks
    .where('[_del+_done+completedAt]')
    .between([0, 1, ''], [0, 1, MAX_STR], true, true)
    .filter((t) => (t.completedAt ?? '').slice(0, 10) === day)
    .toArray();

  const done = closed.length;
  const total = open.length + done;
  return { done, total, ratio: total === 0 ? 0 : done / total };
}

/** Every saved view, in the order the sidebar and the views screen show them. */
export async function savedViews(db: TendDb = getDb()): Promise<SavedView[]> {
  return db.savedViews
    .where('[_del+sortKey]')
    .between([0, ''], [0, MAX_STR])
    .toArray();
}

export async function savedViewById(
  id: string,
  db: TendDb = getDb(),
): Promise<SavedView | undefined> {
  const row = await db.savedViews.get(id);
  return row && row._del === 0 ? row : undefined;
}

/**
 * The candidate set a saved view filters.
 *
 * One index-bound read of everything not deleted, capped, because no compound
 * index can serve a filter that combines a project, tags, a priority floor and
 * a due window. `lib/views/filter.ts` decides from here.
 */
export async function viewCandidates(limit = 2000, db: TendDb = getDb()): Promise<Task[]> {
  return db.tasks.where('_del').equals(0).limit(limit).toArray();
}
