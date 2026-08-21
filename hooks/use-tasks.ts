'use client';

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStableLiveQuery } from './use-live';
import {
  completedBetween,
  dueBetween,
  focusBetween,
  inboxList,
  logbook,
  openTasks,
  overdueList,
  projectOptions,
  searchTasks,
  seriesById,
  sidebarCounts,
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
  TaskSeries,
} from '@/lib/db/types';

/** Module-scope so the reference is stable and never triggers a re-render. */
const NO_TASKS: Task[] = [];

export function useTodayList(): Task[] {
  return useStableLiveQuery(() => todayList(today()), [], NO_TASKS);
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

/** How many open tasks each tag holds. Keyed on the ids so it re-runs when a tag
 *  is added or removed rather than on every render. */
export function useTagCounts(tagIds: readonly string[]): Map<string, number> {
  const key = tagIds.join(',');
  return useStableLiveQuery(
    () => tagCounts(key === '' ? [] : key.split(',')),
    [key],
    NO_COUNTS,
  );
}

/** Open tasks carrying one tag. */
export function useTaggedWith(tagId: string | null): Task[] {
  return useStableLiveQuery(
    () => (tagId === null ? Promise.resolve(NO_TASKS) : taggedWith(tagId)),
    [tagId],
    NO_TASKS,
  );
}

/** id to name, which is what a row needs to print a tag it holds by id. */
export function useTagNames(): Map<string, string> {
  const tags = useTags();
  return useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags]);
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
