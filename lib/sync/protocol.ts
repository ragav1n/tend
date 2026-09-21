import type { EntityTable, MutationOp } from '@/lib/db/types';

/**
 * The shape of the wire between the client and the two route handlers.
 *
 * Imported type-only on the client, so nothing server-side ends up in the
 * bundle. Both sides read this file, which is the point: the RPC signature in
 * supabase/migrations/0003_sync_rpc.sql and these types are one contract
 * described twice, and lib/sync/mapping.test.ts is what keeps the two honest.
 */

/** Postgres table names. The client speaks camelCase, the database does not. */
export type WireTable =
  | 'tasks'
  | 'projects'
  | 'tags'
  | 'areas'
  | 'task_series'
  | 'task_tags'
  | 'focus_sessions'
  | 'activity_log'
  | 'saved_views'
  | 'user_settings'
  | 'terms'
  | 'courses'
  | 'course_components'
  | 'feeds'
  | 'course_events';

export const WIRE_TABLE: Record<EntityTable, WireTable> = {
  tasks: 'tasks',
  areas: 'areas',
  projects: 'projects',
  tags: 'tags',
  taskTags: 'task_tags',
  taskSeries: 'task_series',
  focusSessions: 'focus_sessions',
  activityLog: 'activity_log',
  savedViews: 'saved_views',
  prefs: 'user_settings',
  terms: 'terms',
  courses: 'courses',
  courseComponents: 'course_components',
  feeds: 'feeds',
  courseEvents: 'course_events',
};

export const LOCAL_TABLE: Record<WireTable, EntityTable | null> = {
  tasks: 'tasks',
  projects: 'projects',
  tags: 'tags',
  task_tags: 'taskTags',
  task_series: 'taskSeries',
  focus_sessions: 'focusSessions',
  activity_log: 'activityLog',
  saved_views: 'savedViews',
  user_settings: 'prefs',
  areas: 'areas',
  terms: 'terms',
  courses: 'courses',
  course_components: 'courseComponents',
  feeds: 'feeds',
  course_events: 'courseEvents',
};

// ─── Pull ─────────────────────────────────────────────────────────────────────

export interface PullRequest {
  /** Highest row_version this client has applied. 0 means a full hydrate. */
  cursor: number;
  limit?: number;
}

export interface PullRow {
  table: WireTable;
  row: Record<string, unknown>;
}

export interface PullResponse {
  rows: PullRow[];
  /** Where to resume. Equal to the request cursor when the page was empty. */
  cursor: number;
  hasMore: boolean;
  count: number;
}

// ─── Push ─────────────────────────────────────────────────────────────────────

export interface PushMutation {
  /** Server idempotency key. A retry returns the original result. */
  mutationId: string;
  table: WireTable;
  entityId: string;
  op: MutationOp;
  /** Sparse for an update, the whole row for an insert. Snake case. */
  patch: Record<string, unknown>;
  /** The row_version the client held while editing, which drives the merge. */
  baseVersion: number;
}

export interface PushRequest {
  mutations: PushMutation[];
}

/**
 * `superseded` is the uniqueness race: the row the client tried to insert
 * already exists under another id, because another device created it first. The
 * client drops its local copy and takes the server's on the next pull.
 */
/**
 * `rejected` means the row broke a constraint. Retrying cannot help, so the
 * client retires it rather than sending it again: the local value stays on this
 * device and the badge says something is stranded, which is the honest answer.
 */
export type PushStatus = 'applied' | 'merged' | 'missing' | 'superseded' | 'rejected';

export interface PushResult {
  mutationId: string;
  status: PushStatus;
  entityId: string;
  /** Columns the server kept, because another device changed them later. */
  droppedFields?: string[];
}

export interface PushResponse {
  results: PushResult[];
  /** The user's current counter, so the client can pull straight from here. */
  cursor: number;
}

// ─── Limits ───────────────────────────────────────────────────────────────────
// Mirrored in sync_push, which raises above 200. Keep the two in step.

export const MAX_BATCH_MUTATIONS = 200;
export const MAX_BATCH_BYTES = 512 * 1024;
export const DEFAULT_PULL_LIMIT = 500;
