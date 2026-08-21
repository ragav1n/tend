'use client';

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStableLiveQuery } from './use-live';
import {
  allProjects,
  areaOptions,
  projectCounts,
  projectDone,
  projectList,
  type ProjectCount,
} from '@/lib/db/queries';
import type { Area, Project, Task } from '@/lib/db/types';

const NO_AREAS: Area[] = [];
const NO_PROJECTS: Project[] = [];
const NO_TASKS: Task[] = [];
const NO_COUNTS = new Map<string, ProjectCount>();

export function useAreas(): Area[] {
  return useStableLiveQuery(() => areaOptions(), [], NO_AREAS);
}

/** Every project, archived ones included. The screen decides where to put them. */
export function useAllProjects(): Project[] {
  return useStableLiveQuery(() => allProjects(), [], NO_PROJECTS);
}

/**
 * Every project, plus whether the read has finished.
 *
 * An empty list and a list that has not arrived look identical through
 * `useAllProjects`, which hands back a placeholder either way, and the app's
 * `useFirstLoadComplete` answers a different query: it settles on a `todayList`
 * read, so somebody with projects could see "No projects yet" flash while this
 * one was still going. `useLiveQuery` with no placeholder returns undefined
 * until it settles, which is the distinction the empty state needs.
 */
export function useAllProjectsState(): { projects: Project[]; loaded: boolean } {
  const rows = useLiveQuery(() => allProjects(), []);
  return { projects: rows ?? NO_PROJECTS, loaded: rows !== undefined };
}

/**
 * Counts for a set of projects.
 *
 * Keyed by the ids joined into one string rather than by the array, whose
 * identity changes on every render and would re-run the query with it. The same
 * trick `useNamedTasks` uses.
 */
export function useProjectCounts(projectIds: readonly string[]): Map<string, ProjectCount> {
  const key = projectIds.join(',');
  return useStableLiveQuery(
    () => projectCounts(key === '' ? [] : key.split(',')),
    [key],
    NO_COUNTS,
  );
}

export function useProjectTasks(projectId: string | null): Task[] {
  return useStableLiveQuery(
    () => (projectId ? projectList(projectId) : Promise.resolve(NO_TASKS)),
    [projectId],
    NO_TASKS,
  );
}

/**
 * Everything finished in a project, up to the array bound.
 *
 * The project is the only dependency on purpose. `useStableLiveQuery` hands back
 * its placeholder while deps change, so a limit in here would empty the list on
 * every press of "older" and play the whole enter animation again instead of
 * appending. The screen slices what it shows.
 */
export function useProjectDone(projectId: string | null): Task[] {
  return useStableLiveQuery(
    () => (projectId ? projectDone(projectId) : Promise.resolve(NO_TASKS)),
    [projectId],
    NO_TASKS,
  );
}

export interface AreaGroup {
  /** The area, or null for the projects nobody has filed yet. */
  area: Area | null;
  projects: Project[];
}

/**
 * Projects grouped under their area, with the unfiled ones last.
 *
 * Unfiled goes at the bottom rather than the top, which is the opposite of the
 * board's Inbox column: a project with no area is filed badly, not filed
 * urgently, and the areas somebody built are what they want to look at.
 *
 * An empty area still gets a group. A folder that vanishes when you empty it is
 * a folder you cannot drag anything into.
 */
export function groupByArea(
  areas: readonly Area[],
  projects: readonly Project[],
): AreaGroup[] {
  const byArea = new Map<string, Project[]>();
  for (const project of projects) {
    const key = project.areaId;
    const bucket = byArea.get(key);
    if (bucket) bucket.push(project);
    else byArea.set(key, [project]);
  }

  const groups: AreaGroup[] = areas.map((area) => ({
    area,
    projects: byArea.get(area.id) ?? [],
  }));

  // Anything pointing at an area this device has not pulled yet lands here too,
  // which is better than dropping it off the screen while sync catches up.
  const known = new Set(areas.map((area) => area.id));
  const unfiled = projects.filter((project) => !known.has(project.areaId));
  if (unfiled.length > 0) groups.push({ area: null, projects: unfiled });

  return groups;
}

export function useAreaGroups(projects: readonly Project[]): AreaGroup[] {
  const areas = useAreas();
  // Both arrays come from a live query, which holds its reference while the rows
  // are unchanged, so this recomputes when the data moves and not otherwise.
  return useMemo(() => groupByArea(areas, projects), [areas, projects]);
}
