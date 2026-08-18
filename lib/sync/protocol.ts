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
  | 'user_settings';

export const WIRE_TABLE: Record<EntityTable, WireTable> = {
  tasks: 'tasks',
  projects: 'projects',
  tags: 'tags',
  taskTags: 'task_tags',
  taskSeries: 'task_series',
  prefs: 'user_settings',
};

export const LOCAL_TABLE: Record<WireTable, EntityTable | null> = {
  tasks: 'tasks',
  projects: 'projects',
  tags: 'tags',
  task_tags: 'taskTags',
  task_series: 'taskSeries',
  user_settings: 'prefs',
  // Areas exist server-side so projects can reference them. No local table
  // until the phase that introduces the UI for them.
  areas: null,
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

export type PushStatus = 'applied' | 'merged' | 'missing';

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
