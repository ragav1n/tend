import { compareRank } from '@/lib/db/rank';
import { NO_DUE_DAY, NO_PROJECT, type Priority, type Task } from '@/lib/db/types';

/**
 * A saved view, as a predicate over tasks.
 *
 * Filtering happens here rather than in Dexie. A saved view combines a project,
 * a set of tags, a priority floor and a due window, and IndexedDB has no index
 * that answers all four: any compound index would serve one shape of view and
 * force a full scan for the rest. So one index-bound query fetches the candidate
 * set and this decides, which keeps the interesting part pure and testable.
 *
 * Every field is optional and an absent field means "do not care". That is what
 * makes an empty filter the everything view rather than the nothing view, which
 * is the right answer for a builder somebody has just opened.
 */

/** Which end of the list the view is about. */
export type StatusScope = 'open' | 'done' | 'any';

/**
 * Windows are relative to the day the view is opened, never stored as dates.
 * A view called "This week" that means the week it was created is a view that
 * quietly stops being true.
 */
export type DueWindow = 'any' | 'overdue' | 'today' | 'week' | 'month' | 'none' | 'dated';

export type ViewSort = 'manual' | 'due' | 'priority' | 'created' | 'title' | 'pressure';

export interface ViewFilter {
  status?: StatusScope;
  /** '' means Inbox, which is a real answer. Absent means any project. */
  projectId?: string;
  /** A task must carry all of them. */
  tagIds?: string[];
  /** Lowest priority the view shows. 0 lets everything through. */
  minPriority?: Priority;
  due?: DueWindow;
  /** Matched against the same word tokens search uses. */
  text?: string;
}

export const EMPTY_FILTER: ViewFilter = {};

/**
 * What a priority floor is called, keyed by the floor.
 *
 * Exported so the builder's options read from it too. It said "P1 and up" for
 * the top priority, which is a claim about nothing, while the builder's own
 * dropdown said "P1 only" for the same value.
 */
export const PRIORITY_LABEL: Record<Priority, string> = {
  0: 'Any priority',
  1: 'P3 and up',
  2: 'P2 and up',
  3: 'P1 only',
};

/** Days from `day`, as a plain date. Local by construction: both ends are wall
 *  clock, which is the only kind of date a task has. */
function shift(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inWindow(task: Task, window: DueWindow, today: string): boolean {
  const dated = task._dueDay !== NO_DUE_DAY;

  switch (window) {
    case 'any':
      return true;
    case 'none':
      return !dated;
    case 'dated':
      return dated;
    case 'overdue':
      // A finished task is never overdue, whatever its date says.
      return dated && task._dueDay < today && task._done === 0;
    case 'today':
      return dated && task._dueDay <= today;
    case 'week':
      return dated && task._dueDay <= shift(today, 7);
    case 'month':
      return dated && task._dueDay <= shift(today, 30);
  }
}

/** Lowercased word tokens, the same shape `_words` holds. */
function matchesText(task: Task, text: string): boolean {
  const terms = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return terms.every((term) => task._words.some((word) => word.startsWith(term)));
}

export function matchesFilter(task: Task, filter: ViewFilter, today: string): boolean {
  if (task._del === 1) return false;

  const status = filter.status ?? 'open';
  if (status === 'open' && task._done === 1) return false;
  if (status === 'done' && task._done === 0) return false;

  if (filter.projectId !== undefined && task.projectId !== filter.projectId) return false;

  if (filter.tagIds && filter.tagIds.length > 0) {
    if (!filter.tagIds.every((id) => task._tagIds.includes(id))) return false;
  }

  if (filter.minPriority !== undefined && task.priority < filter.minPriority) return false;
  if (!inWindow(task, filter.due ?? 'any', today)) return false;
  if (filter.text && filter.text.trim() !== '' && !matchesText(task, filter.text)) return false;

  return true;
}

/**
 * Sorts a view's rows.
 *
 * `manual` is the list's own order. Every other mode breaks ties with the
 * manual key rather than leaving them to the engine, so opening the same view
 * twice never reshuffles rows that compare equal.
 */
export function sortTasks(tasks: readonly Task[], sort: ViewSort): Task[] {
  const rows = [...tasks];

  switch (sort) {
    case 'manual':
      return rows.sort(compareRank);
    case 'due':
      // Undated work sorts last, which NO_DUE_DAY already does by construction.
      return rows.sort((a, b) => a._dueDay.localeCompare(b._dueDay) || compareRank(a, b));
    case 'priority':
      return rows.sort((a, b) => b.priority - a.priority || compareRank(a, b));
    case 'created':
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || compareRank(a, b));
    case 'title':
      return rows.sort(
        (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || compareRank(a, b),
      );
    case 'pressure':
      // Tightest first, which is not the same as soonest. A task due Friday
      // behind four days of committed work is under more pressure than one due
      // Wednesday with nothing before it, and sorting by date hides that.
      //
      // Slack needs capacity and every other deadline, so it is not derivable
      // from one row here. Without it this falls back to due order, which is
      // the honest degradation: `sortTasks` is pure and stays that way.
      return rows.sort((a, b) => a._dueDay.localeCompare(b._dueDay) || compareRank(a, b));
  }
}

/**
 * Tightest deadline first, given the slack the page worked out.
 *
 * Separate from `sortTasks` because it needs an argument that function does not
 * take, and threading capacity through every sort to serve one mode would make
 * the pure comparator impure for all of them.
 */
export function sortByPressure(
  tasks: readonly Task[],
  slack: ReadonlyMap<string, { slack: number }>,
): Task[] {
  return [...tasks].sort((a, b) => {
    // Undated work is under no deadline pressure, so it sorts last rather than
    // first, which a plain numeric compare on a missing value would do.
    const left = slack.get(a._dueDay)?.slack ?? Number.POSITIVE_INFINITY;
    const right = slack.get(b._dueDay)?.slack ?? Number.POSITIVE_INFINITY;
    return left - right || a._dueDay.localeCompare(b._dueDay) || compareRank(a, b);
  });
}

export function applyView(
  tasks: readonly Task[],
  filter: ViewFilter,
  sort: ViewSort,
  today: string,
): Task[] {
  return sortTasks(
    tasks.filter((task) => matchesFilter(task, filter, today)),
    sort,
  );
}

/** One line under the view's name, so a list of views says what each one holds. */
export function describeFilter(
  filter: ViewFilter,
  names: { projects: Map<string, string>; tags: Map<string, string> },
): string {
  const parts: string[] = [];

  const status = filter.status ?? 'open';
  if (status === 'done') parts.push('Completed');
  else if (status === 'any') parts.push('Open and completed');

  if (filter.projectId !== undefined) {
    parts.push(
      filter.projectId === NO_PROJECT
        ? 'Inbox'
        : (names.projects.get(filter.projectId) ?? 'a project'),
    );
  }

  for (const id of filter.tagIds ?? []) parts.push(`#${names.tags.get(id) ?? 'tag'}`);

  if (filter.minPriority) parts.push(PRIORITY_LABEL[filter.minPriority]);

  const windows: Record<DueWindow, string> = {
    any: '',
    overdue: 'Overdue',
    today: 'Due by today',
    week: 'Due within a week',
    month: 'Due within a month',
    none: 'No date',
    dated: 'Has a date',
  };
  const window = windows[filter.due ?? 'any'];
  if (window) parts.push(window);

  if (filter.text?.trim()) parts.push(`"${filter.text.trim()}"`);

  return parts.length > 0 ? parts.join(' · ') : 'Everything open';
}
