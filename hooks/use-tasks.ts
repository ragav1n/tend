'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useStableLiveQuery } from './use-live';
import {
  inboxList,
  logbook,
  projectOptions,
  searchTasks,
  seriesById,
  sidebarCounts,
  somedayList,
  subtasksOf,
  tagOptions,
  taskById,
  today,
  todayList,
  todayProgress,
  upcomingList,
} from '@/lib/db/queries';
import type { Project, Tag, Task, TaskSeries } from '@/lib/db/types';

/** Module-scope so the reference is stable and never triggers a re-render. */
const NO_TASKS: Task[] = [];

export function useTodayList(): Task[] {
  return useStableLiveQuery(() => todayList(today()), [], NO_TASKS);
}

export function useUpcomingList(days = 30): Task[] {
  return useStableLiveQuery(() => upcomingList(today(), days), [days], NO_TASKS);
}

export function useInboxList(): Task[] {
  return useStableLiveQuery(() => inboxList(), [], NO_TASKS);
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
