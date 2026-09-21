'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useStableLiveQuery } from './use-live';
import {
  completedBetween,
  dueBetween,
  focusBetween,
  cancelledList,
  inboxDeferred,
  inboxList,
  logbook,
  openTasks,
  overdueList,
  projectOptions,
  searchTasks,
  seriesById,
  sidebarCounts,
  somedayDeferred,
  somedayList,
  subtasksForParents,
  subtasksOf,
  taggedWith,
  tagCounts,
  tagOptions,
  taskById,
  taskHistory,
  tasksByIds,
  today,
  remindersFor,
  todayDeferred,
  todayList,
  todayProgress,
  upcomingList,
} from '@/lib/db/queries';
import type {
  ActivityEntry,
  FocusSession,
  Project,
  Tag,
  Task,
  TaskReminder,
  TaskSeries,
} from '@/lib/db/types';

/** Module-scope so the reference is stable and never triggers a re-render. */
const NO_TASKS: Task[] = [];

export function useTodayList(): Task[] {
  return useStableLiveQuery(() => todayList(today()), [], NO_TASKS);
}

/**
 * What each working list is holding back until its start date.
 *
 * A second live query per page rather than a second return value on the first,
 * which would have changed the shape every list hook and twenty-odd assertions
 * already agree on. Both run the same index-bound scan, and the deferred half of
 * a task list is a handful of rows.
 */
export function useTodayDeferred(): Task[] {
  return useStableLiveQuery(() => todayDeferred(today()), [], NO_TASKS);
}

export function useInboxDeferred(): Task[] {
  return useStableLiveQuery(() => inboxDeferred(), [], NO_TASKS);
}

export function useSomedayDeferred(): Task[] {
  return useStableLiveQuery(() => somedayDeferred(), [], NO_TASKS);
}

export function useUpcomingList(days = 30): Task[] {
  return useStableLiveQuery(() => upcomingList(today(), days), [days], NO_TASKS);
}

/** Everything dated inside a window, which is what the calendar grid reads. */
export function useDueBetween(from: string, to: string): Task[] {
  return useStableLiveQuery(() => dueBetween(from, to), [from, to], NO_TASKS);
}

export function useInboxList(): Task[] {
  return useStableLiveQuery(() => inboxList(), [], NO_TASKS);
}

/** Every open top-level task, which is what the board groups. */
export function useOpenTasks(): Task[] {
  return useStableLiveQuery(() => openTasks(), [], NO_TASKS);
}

export function useSomedayList(): Task[] {
  return useStableLiveQuery(() => somedayList(), [], NO_TASKS);
}

/** Work given up on, newest first. One scan over `[_del+cancelledAt]`. */
export function useCancelledList(limit = 100): Task[] {
  return useStableLiveQuery(() => cancelledList(limit), [limit], NO_TASKS);
}

export function useLogbook(limit = 100): Task[] {
  return useStableLiveQuery(() => logbook(limit), [limit], NO_TASKS);
}

export function useSubtasks(taskId: string): Task[] {
  return useStableLiveQuery(() => subtasksOf(taskId), [taskId], NO_TASKS);
}

const NO_SUBTASKS = new Map<string, Task[]>();

/**
 * The children of every parent in a list, keyed by parent.
 *
 * The ids are joined into one string so the dependency is a value rather than
 * an array identity, which changes on every render and would re-run the query
 * with it. Same trick `useTasksByIds` uses.
 */
export function useSubtasksFor(parentIds: readonly string[]): Map<string, Task[]> {
  const key = parentIds.join(',');
  return useStableLiveQuery(
    () => subtasksForParents(key === '' ? [] : key.split(',')),
    [key],
    NO_SUBTASKS,
  );
}

/** Debouncing lives in the input, not here: this fires per committed query. */
export function useSearch(query: string): Task[] {
  return useStableLiveQuery(
    () => (query.trim().length === 0 ? Promise.resolve(NO_TASKS) : searchTasks(query)),
    [query],
    NO_TASKS,
  );
}

const ZERO_COUNTS = { today: 0, overdue: 0, inbox: 0, upcoming: 0 };

export function useSidebarCounts() {
  return useStableLiveQuery(() => sidebarCounts(today()), [], ZERO_COUNTS);
}

const ZERO_PROGRESS = { done: 0, total: 0, ratio: 0 };

export function useTodayProgress() {
  return useStableLiveQuery(() => todayProgress(today()), [], ZERO_PROGRESS);
}

/**
 * Undefined until the first read settles, which is what distinguishes "still
 * opening IndexedDB" from "you genuinely have no tasks". The raw hook is right
 * here, since the whole point is to observe the undefined.
 */
export function useFirstLoadComplete(): boolean {
  const count = useLiveQuery(() => todayList(today()).then((r) => r.length), []);
  return count !== undefined;
}

/**
 * One task, live.
 *
 * Deliberately not wrapped in `useStableLiveQuery`: the detail panel needs to
 * tell "still reading" from "this row is gone", and undefined is the only value
 * that carries the difference. A soft delete keeps returning the row with
 * `_del: 1`, which is what the panel watches to close itself.
 */
export function useTask(id: string | null): Task | undefined {
  return useLiveQuery(() => (id ? taskById(id) : Promise.resolve(undefined)), [id]);
}

export function useSeries(seriesId: string | undefined): TaskSeries | undefined {
  return useLiveQuery(() => seriesById(seriesId ?? ''), [seriesId]);
}

const NO_PROJECTS: Project[] = [];
const NO_TAGS: Tag[] = [];

export function useProjects(): Project[] {
  return useStableLiveQuery(() => projectOptions(), [], NO_PROJECTS);
}

export function useTags(): Tag[] {
  return useStableLiveQuery(() => tagOptions(), [], NO_TAGS);
}

const NO_COUNTS = new Map<string, number>();

/** How many open tasks each tag holds. No dependency, so the counts never blink
 *  back to the placeholder when the tag list resolves. */
export function useTagCounts(): Map<string, number> {
  return useStableLiveQuery(() => tagCounts(), [], NO_COUNTS);
}

/** Open tasks carrying one tag. */
export function useTaggedWith(tagId: string | null): Task[] {
  return useStableLiveQuery(
    () => (tagId === null ? Promise.resolve(NO_TASKS) : taggedWith(tagId)),
    [tagId],
    NO_TASKS,
  );
}

const NO_SESSIONS: FocusSession[] = [];

/**
 * Named tasks, live.
 *
 * The ids are joined into one string so the dependency is a value rather than an
 * array identity, which changes on every render and would re-run the query with
 * it.
 */
export function useTasksByIds(ids: readonly string[]): Task[] {
  const key = [...new Set(ids)].filter(Boolean).sort().join(',');
  return useStableLiveQuery(() => tasksByIds(key === '' ? [] : key.split(',')), [key], NO_TASKS);
}

/** Tasks completed inside a window. Both bounds are instants. */
export function useCompletedBetween(from: string, to: string): Task[] {
  return useStableLiveQuery(() => completedBetween(from, to), [from, to], NO_TASKS);
}

/** Open work whose due date has passed. */
export function useOverdue(): Task[] {
  return useStableLiveQuery(() => overdueList(today()), [], NO_TASKS);
}

/** Focus sessions that began inside a window. Both bounds are instants. */
export function useFocusBetween(from: string, to: string): FocusSession[] {
  return useStableLiveQuery(() => focusBetween(from, to), [from, to], NO_SESSIONS);
}

/**
 * One task's history, newest first.
 *
 * Raw rather than stable, for the same reason `useTask` is: undefined means the
 * read has not settled, and the panel has to tell that apart from a task with
 * nothing recorded against it. A placeholder would render "No history yet" on
 * every open, for one frame, on a task with forty entries.
 */
export function useTaskHistory(taskId: string): ActivityEntry[] | undefined {
  return useLiveQuery(() => taskHistory(taskId), [taskId]);
}

/** The explicit reminders on one task. Empty means the global lead applies. */
export function useTaskReminders(taskId: string): TaskReminder[] {
  return useStableLiveQuery(() => remindersFor(taskId), [taskId], NO_REMINDERS);
}

const NO_REMINDERS: TaskReminder[] = [];
