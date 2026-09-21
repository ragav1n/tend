import { getDb, type TendDb } from './client';
import { foldText } from './derive';
import { comparePlannedRank, compareRank } from './rank';
import { isDeferred } from '@/lib/views/defer';
import {
  NO_DUE_DAY,
  NO_PARENT,
  NO_PROJECT,
  type ActivityEntry,
  type Area,
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
 * Which run of the Today list a row sits in.
 *
 * Exported because the reorder carets have to group by the same rule this sort
 * used. Read off a second copy of the predicate, the two would agree until one
 * of them changed, and a row would move somewhere the sort put straight back.
 */
export function todayGroup(task: Task, day: PlainDate): 'overdue' | 'today' {
  return task._dueDay < day && task._dueDay !== NO_DUE_DAY ? 'overdue' : 'today';
}

/**
 * The Today list: overdue, due today, and anything explicitly planned for today.
 *
 * Two index scans merged by id rather than one scan with a filter, because a
 * filter would have to walk every open task. Subtasks are excluded: they render
 * underneath their parent, so surfacing them at top level would show the same
 * work twice.
 *
 * Inside a run the order is `plannedSortKey`, not `sortKey`. That column and the
 * index leading with it were built for a Today list arranged by hand, and this
 * sort threw the arrangement away: every row here also lives in a project list,
 * so ordering both by the same column means arranging Today rearranges four
 * other screens.
 */
async function todayCandidates(day: PlainDate, db: TendDb): Promise<Task[]> {
  const [due, planned] = await Promise.all([dueThrough(day, db), plannedFor(day, db)]);

  const byId = new Map<string, Task>();
  for (const t of [...due, ...planned]) {
    if (t.parentTaskId !== NO_PARENT) continue;
    byId.set(t.id, t);
  }

  // Overdue first, then today's work. Inside each group, the user's order.
  const rows = [...byId.values()];
  rows.sort((a, b) => {
    const aOver = todayGroup(a, day) === 'overdue' ? 0 : 1;
    const bOver = todayGroup(b, day) === 'overdue' ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    return comparePlannedRank(a, b);
  });
  return rows;
}

export async function todayList(day = today(), db: TendDb = getDb()): Promise<Task[]> {
  return (await todayCandidates(day, db)).filter((t) => !isDeferred(t, day));
}

/** The other half: what this list is holding back until its start date. */
export async function todayDeferred(day = today(), db: TendDb = getDb()): Promise<Task[]> {
  return (await todayCandidates(day, db)).filter((t) => isDeferred(t, day));
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

async function inboxCandidates(db: TendDb): Promise<Task[]> {
  const rows = await db.tasks
    .where('[_del+projectId+_done+sortKey]')
    .between([0, NO_PROJECT, 0, ''], [0, NO_PROJECT, 0, MAX_STR], true, true)
    .toArray();
  return rows.filter((t) => t.parentTaskId === NO_PARENT).sort(compareRank);
}

/** Unfiled top-level tasks, which is what Inbox means. */
export async function inboxList(db: TendDb = getDb(), day = today()): Promise<Task[]> {
  return (await inboxCandidates(db)).filter((t) => !isDeferred(t, day));
}

export async function inboxDeferred(db: TendDb = getDb(), day = today()): Promise<Task[]> {
  return (await inboxCandidates(db)).filter((t) => isDeferred(t, day));
}

async function somedayCandidates(db: TendDb): Promise<Task[]> {
  const rows = await db.tasks
    .where('[_del+_done+_dueDay+sortKey]')
    .between([0, 0, NO_DUE_DAY, ''], [0, 0, NO_DUE_DAY, MAX_STR], true, true)
    .toArray();
  return rows.filter((t) => t.parentTaskId === NO_PARENT);
}

/** Dateless tasks, the "no commitment yet" pile. */
export async function somedayList(db: TendDb = getDb(), day = today()): Promise<Task[]> {
  return (await somedayCandidates(db)).filter((t) => !isDeferred(t, day));
}

export async function somedayDeferred(db: TendDb = getDb(), day = today()): Promise<Task[]> {
  return (await somedayCandidates(db)).filter((t) => isDeferred(t, day));
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

/**
 * The children of several parents at once, keyed by parent.
 *
 * Every list query already drops subtasks with the note that they "render
 * underneath their parent", so this is what makes that true. One range scan per
 * parent over `[_del+parentTaskId+sortKey]`, run together: a scan bounded to one
 * parent's children is a handful of rows, and the alternative is a filter over
 * every open task in the store.
 *
 * Parents with no children are left out of the map rather than given an empty
 * array, so a caller can ask `has` instead of checking a length.
 */
export async function subtasksForParents(
  parentIds: readonly string[],
  db: TendDb = getDb(),
): Promise<Map<string, Task[]>> {
  const out = new Map<string, Task[]>();
  if (parentIds.length === 0) return out;

  const groups = await Promise.all(parentIds.map((id) => subtasksOf(id, db)));
  parentIds.forEach((id, i) => {
    const rows = groups[i];
    if (rows && rows.length > 0) out.set(id, rows.sort(compareRank));
  });
  return out;
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

/** Every project including the archived ones, in the user's order. The projects
 *  screen is the only caller: everywhere else an archived project is finished
 *  business and offering it in a picker would refile work into it. */
export async function allProjects(db: TendDb = getDb()): Promise<Project[]> {
  const rows = await db.projects
    .where('[_del+_archived+sortKey]')
    .between([0, 0, ''], [0, 1, MAX_STR], true, true)
    .toArray();
  return rows.sort(compareRank);
}

/** Every live area, in the user's order. A handful of rows, read whole. */
export async function areaOptions(db: TendDb = getDb()): Promise<Area[]> {
  const rows = await db.areas
    .where('[_del+sortKey]')
    .between([0, ''], [0, MAX_STR], true, true)
    .toArray();
  return rows.sort(compareRank);
}

export interface ProjectCount {
  open: number;
  done: number;
}

/**
 * Open and finished counts per project.
 *
 * Two index counts per project over `[_del+projectId+_done+sortKey]`, which is
 * a bounded range each rather than a scan of the store. The alternative is one
 * read of every live task tallied in memory, and that read grows with the whole
 * store while this one grows with the number of projects.
 *
 * Subtasks are left out, the same way every list query leaves them out: a
 * subtask carries no project of its own, so counting one would be counting its
 * parent twice.
 *
 * A cancelled task counts as neither. `_done` is 1 for done **or** cancelled,
 * because both leave the open lists, so the index range has to be narrowed by
 * status afterwards. Counting an abandoned task as finished would report a
 * project as further along than it is, which is the one thing a progress ring
 * must not do.
 */
export async function projectCounts(
  projectIds: readonly string[],
  db: TendDb = getDb(),
): Promise<Map<string, ProjectCount>> {
  const out = new Map<string, ProjectCount>();

  const counts = await Promise.all(
    projectIds.map(async (id) => {
      const range = (closed: 0 | 1) =>
        db.tasks
          .where('[_del+projectId+_done+sortKey]')
          .between([0, id, closed, ''], [0, id, closed, MAX_STR], true, true)
          .toArray();
      const [open, closed] = await Promise.all([range(0), range(1)]);
      return {
        id,
        open: open.filter((t) => t.parentTaskId === NO_PARENT).length,
        done: closed.filter((t) => t.parentTaskId === NO_PARENT && t.status === 'done').length,
      };
    }),
  );

  for (const row of counts) out.set(row.id, { open: row.open, done: row.done });
  return out;
}

/**
 * A project's finished tasks, newest first, so its own screen can show what got
 * done rather than only what is left.
 *
 * Cancelled tasks are excluded for the reason `projectCounts` gives: `_done`
 * covers both, and a list headed "Done" that contains work somebody abandoned is
 * mislabelled. They also carry no `completedAt`, so they sorted to the end and
 * were the first thing the limit cut, which hid the bug on a big project and
 * showed it on a small one.
 */
/**
 * How many finished tasks a project shows at a time.
 *
 * The screen used to stop at 50 with nothing that could ask for the rest, so a
 * project with a year of history had a wall it never mentioned. The slice is
 * taken in the component rather than here: the limit below is not a query bound,
 * since the read walks the whole index range either way, so paging through the
 * query would only make `limit` a dependency and empty the list on every press.
 */
export const PROJECT_DONE_PAGE = 25;

/** A bound on the array, not on the read. Far past what a screen shows, and the
 *  logbook is where a project with more than this belongs. */
export const PROJECT_DONE_MAX = 500;

export async function projectDone(
  projectId: string,
  limit = PROJECT_DONE_MAX,
  db: TendDb = getDb(),
): Promise<Task[]> {
  const rows = await db.tasks
    .where('[_del+projectId+_done+sortKey]')
    .between([0, projectId, 1, ''], [0, projectId, 1, MAX_STR], true, true)
    .toArray();
  return rows
    .filter((t) => t.parentTaskId === NO_PARENT && t.status === 'done')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, limit);
}

/** One project by id, or undefined once it is deleted. */
export async function projectById(
  id: string,
  db: TendDb = getDb(),
): Promise<Project | undefined> {
  if (id === NO_PROJECT) return undefined;
  const project = await db.projects.get(id);
  return project && project._del === 0 ? project : undefined;
}

/** Every live tag, alphabetical. Also small enough to read whole. */
export async function tagOptions(db: TendDb = getDb()): Promise<Tag[]> {
  return db.tags.where('[_del+name]').between([0, ''], [0, MAX_STR], true, true).toArray();
}

/**
 * Open tasks per tag, for the tag index.
 *
 * Walks the tagged tasks rather than the table: the multiEntry index yields an
 * entry per tag on a task, and `distinct` collapses a task carrying two of the
 * asked-for tags back to one row. A count over `db.taskTags` would need the
 * status of every task it named, which is the read this avoids.
 *
 * It reads the live tags itself rather than taking their ids. Passed in, the
 * ids are a changing dependency, and `useStableLiveQuery` shows the placeholder
 * while a dependency change settles: every count on the tag index blinked to
 * zero for a paint each time the tag list resolved.
 *
 * Counts top-level tasks only, which is what `taggedWith` lists. A count that
 * includes a tagged subtask disagrees with the screen underneath it.
 */
export async function tagCounts(db: TendDb = getDb()): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const tags = await tagOptions(db);
  if (tags.length === 0) return counts;

  const wanted = new Set(tags.map((tag) => tag.id));
  const rows = await db.tasks
    .where('_tagIds')
    .anyOf([...wanted])
    .distinct()
    .toArray();

  for (const task of rows) {
    if (task._del === 1 || task._done === 1 || task.parentTaskId !== NO_PARENT) continue;
    for (const tagId of task._tagIds) {
      if (wanted.has(tagId)) counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Tag filter, served by the multiEntry `_tagIds` index.
 *
 * Top level only, like every other list here: a subtask renders under its
 * parent. Without that filter the tag screen showed a tagged subtask twice,
 * once as a row of its own and once nested under its parent, two DOM nodes
 * carrying the same id for the keyboard cursor to walk onto.
 */
export async function taggedWith(tagId: string, db: TendDb = getDb()): Promise<Task[]> {
  const rows = await db.tasks.where('_tagIds').equals(tagId).toArray();
  return rows
    .filter((t) => t._del === 0 && t._done === 0 && t.parentTaskId === NO_PARENT)
    .sort(compareRank);
}

/**
 * Prefix search over the multiEntry `_words` index, plus the tag names.
 *
 * Bounded at 50 because this runs on every keystroke. A multi-word query
 * intersects per-term result sets, so "buy milk" beats either term alone.
 *
 * A tag counts as a match for the term it spells. `tokenize` covers the title
 * and the notes, so searching "work" used to miss every task tagged #work while
 * the palette happily offered #work as a place to jump to. Resolved here rather
 * than folded into `_words`, which would mean re-deriving every tagged task on
 * every rename to keep an index of something the tag row already knows.
 */
export async function searchTasks(
  query: string,
  limit = 50,
  db: TendDb = getDb(),
): Promise<Task[]> {
  // Folded the way `tokenize` folds what it indexed. Lowercasing alone left a
  // query for "café" looking for "caf", which matched by luck rather than rule.
  const terms = foldText(query)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  if (terms.length === 0) return [];

  // Read whole, which is what every other tag query does: there are a handful of
  // them and the alternative is an index scan per term.
  const tags = await tagOptions(db);

  const sets = await Promise.all(
    terms.map(async (term) => {
      // A term is satisfied by a word in the title or notes OR by a tag on the
      // task. Terms still AND together, so "milk work" means both.
      const named = tags
        .filter((tag) => foldText(tag.name).startsWith(term))
        .map((tag) => tag.id);

      const [byWord, byTag] = await Promise.all([
        db.tasks.where('_words').startsWith(term).limit(500).primaryKeys(),
        named.length === 0
          ? Promise.resolve([] as string[])
          : db.tasks.where('_tagIds').anyOf(named).distinct().limit(500).primaryKeys(),
      ]);

      return [...byWord, ...byTag] as string[];
    }),
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
/**
 * The cancelled pile, newest first.
 *
 * One range scan over `[_del+cancelledAt]`, and the index is the list: only a
 * cancelled row carries a `cancelledAt`, and IndexedDB leaves a record out of a
 * compound index when a component is null, so nothing else is in there to
 * filter out.
 *
 * Bounded like the logbook. Work you gave up on is worth being able to find, not
 * worth deserializing all of.
 */
export async function cancelledList(limit = 100, db: TendDb = getDb()): Promise<Task[]> {
  const rows = await db.tasks
    .where('[_del+cancelledAt]')
    .between([0, ''], [0, MAX_STR], true, true)
    .reverse()
    .limit(limit)
    .toArray();
  return rows.filter((t) => t.parentTaskId === NO_PARENT);
}

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

/** How much of one task's history the detail panel reads. Older entries are
 *  not fetched at all, and the panel says so once it is holding this many. */
export const TASK_HISTORY_LIMIT = 40;

/**
 * One task's history, newest first.
 *
 * Undone entries stay in it. The entry is still true, it just no longer stands,
 * and dropping the second half would leave the panel claiming a change that was
 * taken back an hour ago.
 */
export async function taskHistory(
  taskId: string,
  limit = TASK_HISTORY_LIMIT,
  db: TendDb = getDb(),
): Promise<ActivityEntry[]> {
  return db.activityLog
    .where('[_del+entityId+createdAt]')
    .between([0, taskId, ''], [0, taskId, MAX_STR])
    .reverse()
    .limit(limit)
    .toArray();
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

/** Above this a saved view stops reading the whole store on the main thread and
 *  says so instead. `toArray()` on tasks is banned for the same reason. */
export const VIEW_CANDIDATE_LIMIT = 5000;

export interface Candidates {
  tasks: Task[];
  /** True when the cap bit, so a caller can say the answer is partial rather
   *  than quietly showing a filtered subset of a subset. */
  truncated: boolean;
}

/**
 * The candidate set a saved view filters.
 *
 * One index-bound read of everything not deleted, capped, because no compound
 * index can serve a filter that combines a project, tags, a priority floor and
 * a due window. `lib/views/filter.ts` decides from here.
 *
 * The cap is reported rather than applied in silence. It walks the `_del` index
 * in primary-key order, so a truncated read is the oldest N ids and everything
 * created after them is invisible: a view that quietly omits half your tasks is
 * worse than one that admits it.
 */
export async function viewCandidates(
  limit = VIEW_CANDIDATE_LIMIT,
  db: TendDb = getDb(),
): Promise<Candidates> {
  // One over the limit, so "is there more" costs no second query.
  const rows = await db.tasks.where('_del').equals(0).limit(limit + 1).toArray();
  return { tasks: rows.slice(0, limit), truncated: rows.length > limit };
}
