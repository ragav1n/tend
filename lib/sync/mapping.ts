import {
  NO_PARENT,
  NO_PROJECT,
  type FocusSession,
  type Task,
  type Tag,
  type Project,
  type TaskSeries,
} from '@/lib/db/types';
import type { WireTable } from './protocol';

/**
 * Local rows and wire rows are not the same shape, and this is the only place
 * that knows it.
 *
 * Two differences, both forced rather than stylistic:
 *
 *   1. **Case.** Postgres columns are snake_case and the local rows are
 *      camelCase. Converting per field rather than maintaining a hand-written
 *      map per table means a column added server-side needs no change here.
 *
 *   2. **Sentinels.** IndexedDB cannot index null, so `projectId` is `''` for
 *      Inbox and `parentTaskId` is `''` for a top-level task. Postgres has a
 *      real null and a foreign key that would reject an empty uuid. The
 *      conversion has to happen exactly once, in one direction each way, or the
 *      two stores disagree about what "no project" means.
 *
 * Derived fields never cross the wire. They are recomputed by derive.ts on the
 * way in, which is what keeps the optimistic path and the server-apply path
 * from diverging.
 */

/**
 * Local columns that carry `''` where Postgres carries null.
 *
 * Every nullable uuid a client can write belongs here. Postgres rejects `''` as
 * a uuid outright, with a 22P02 the client classifies as fatal, so a column
 * missing from this list means that whole table never syncs and every mutation
 * for it lands in the deadletter. `projects.area_id` was missing until the
 * convergence test created a project on one device.
 */
const SENTINEL_COLUMNS: Partial<Record<WireTable, string[]>> = {
  tasks: ['project_id', 'parent_task_id', 'series_id', 'course_id', 'component_id'],
  projects: ['area_id'],
  focus_sessions: ['task_id'],
  courses: ['term_id'],
};

export function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function toCamelCase(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Derived index fields are local-only, so they never leave. */
function isDerived(key: string): boolean {
  return key.startsWith('_');
}

/**
 * A local patch as the server wants it: snake case, sentinels turned into null,
 * derived fields gone.
 */
export function localToWire(
  table: WireTable,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const sentinels = new Set(SENTINEL_COLUMNS[table] ?? []);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (isDerived(key)) continue;
    const column = toSnakeCase(key);
    out[column] = sentinels.has(column) && value === '' ? null : value;
  }

  return out;
}

/**
 * A server row as the local store wants it: camel case, nulls turned back into
 * sentinels. Derived fields are not added here; the caller runs derive.ts, so
 * there stays exactly one place that computes them.
 */
export function wireToLocal(
  table: WireTable,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const sentinels = new Set(SENTINEL_COLUMNS[table] ?? []);
  const out: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(row)) {
    // Carried alongside the task rather than as its own sync channel, so the
    // caller handles it against the taskTags table instead of putting an array
    // on the row.
    if (column === 'tag_ids') continue;
    out[toCamelCase(column)] = sentinels.has(column) && value === null ? '' : value;
  }

  return out;
}

/** The complete tag set the server sent with a task, or null when absent. */
export function tagIdsOf(row: Record<string, unknown>): string[] | null {
  const value = row.tag_ids;
  return Array.isArray(value) ? (value as string[]) : null;
}

/**
 * Rows arriving from a pull are trusted for shape but not for completeness: a
 * column added server-side before this client shipped would be dropped by a
 * strict parse. So the local row is built by merging over what already exists,
 * and these are the fields the local store requires to have a value.
 */
export function isCompleteTask(row: Record<string, unknown>): row is Partial<Task> {
  return typeof row.id === 'string' && typeof row.title === 'string';
}

export type SyncedLocalRow = Task | Project | Tag | TaskSeries | FocusSession;

/** Sentinel defaults for a task row that arrived without them. */
export const TASK_SENTINEL_DEFAULTS = {
  projectId: NO_PROJECT,
  parentTaskId: NO_PARENT,
  seriesId: '',
} as const;
