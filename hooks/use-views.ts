'use client';

import { useMemo } from 'react';
import { useStableLiveQuery } from './use-live';
import { savedViews, today, viewCandidates, type Candidates } from '@/lib/db/queries';
import type { SavedView, Task } from '@/lib/db/types';
import { applyView, type ViewFilter, type ViewSort } from '@/lib/views/filter';

const NO_VIEWS: SavedView[] = [];
const NO_CANDIDATES: Candidates = { tasks: [], truncated: false };

export function useSavedViews(): SavedView[] {
  return useStableLiveQuery(() => savedViews(), [], NO_VIEWS);
}

export function useSavedView(id: string | null): SavedView | undefined {
  const views = useSavedViews();
  return id ? views.find((view) => view.id === id) : undefined;
}

/**
 * The rows a view holds.
 *
 * One bounded read of every live task, filtered in memory. No compound index
 * can serve a filter that combines a project, tags, a priority floor and a due
 * window, so the alternative is an index per shape of view.
 *
 * The filter is keyed by its JSON, not its object identity, so a caller can
 * build it inline without re-running the query on every render.
 */
export function useViewTasks(
  filter: ViewFilter,
  sort: ViewSort,
): { tasks: Task[]; truncated: boolean } {
  const key = JSON.stringify(filter);
  const candidates = useStableLiveQuery(() => viewCandidates(), [], NO_CANDIDATES);

  const tasks = useMemo(
    () => applyView(candidates.tasks, JSON.parse(key) as ViewFilter, sort, today()),
    [candidates.tasks, key, sort],
  );

  return { tasks, truncated: candidates.truncated };
}
