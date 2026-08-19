import Dexie, { type EntityTable, type Table } from 'dexie';
import { APP_DB_PREFIX } from '@/lib/config';
import { openWithRecovery, type OpenOutcome } from './recovery';
import { defineSchema } from './schema';
import type {
  ActivityEntry,
  FocusSession,
  OutboxRecord,
  Prefs,
  Project,
  SyncMetaRow,
  Tag,
  Task,
  TaskSeries,
  TaskTag,
} from './types';

/**
 * Phase 0 runs with no auth, so every row belongs to this placeholder user. When
 * Supabase auth lands the real user id replaces it, and the local rows get
 * rewritten once on first sign-in.
 */
export const LOCAL_USER_ID = 'local';

export interface DeadLetterRow {
  mutationId: string;
  table: string;
  entityId: string;
  createdAt: number;
  reason: string;
}

export interface ConflictRow {
  id?: number;
  table: string;
  entityId: string;
  at: number;
  droppedFields: string[];
}

export interface ReminderStateRow {
  taskId: string;
  firedForAt: string;
}

export class TendDb extends Dexie {
  tasks!: EntityTable<Task, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  /** Compound primary key, so this is a plain Table rather than an EntityTable. */
  taskTags!: Table<TaskTag, [string, string]>;
  taskSeries!: EntityTable<TaskSeries, 'id'>;
  focusSessions!: EntityTable<FocusSession, 'id'>;
  activityLog!: EntityTable<ActivityEntry, 'id'>;
  prefs!: EntityTable<Prefs, 'id'>;
  /** Auto-incrementing seq, so the key type is a number. */
  outbox!: Table<OutboxRecord, number>;
  deadletter!: EntityTable<DeadLetterRow, 'mutationId'>;
  conflicts!: Table<ConflictRow, number>;
  syncMeta!: EntityTable<SyncMetaRow, 'key'>;
  reminderState!: EntityTable<ReminderStateRow, 'taskId'>;

  constructor(name: string) {
    super(name);
    defineSchema(this);
  }
}

/**
 * One database per user. This is the clean answer to signing in as a different
 * account: the second account cannot see, merge or clobber the first one's rows
 * or its unsynced outbox, and switching back finds everything intact.
 */
export function dbNameFor(userId: string): string {
  return `${APP_DB_PREFIX}_${userId}`;
}

let instance: TendDb | null = null;

/**
 * The live database handle, as a module singleton rather than React context
 * because `mutations.ts` and the sync engine both need it outside the component
 * tree.
 */
export function getDb(): TendDb {
  if (!instance) instance = new TendDb(dbNameFor(LOCAL_USER_ID));
  return instance;
}

/**
 * Opens through the recovery ladder, and answers with what it took.
 *
 * Idempotent, so calling it from a provider on mount is safe. The outcome is
 * returned rather than thrown because three of the four failures have different
 * fixes and only the caller can say them: another tab to close, a reload, or a
 * rebuild that the person deserves to be told about.
 *
 * A rebuild replaces the singleton, so `getDb()` hands the rest of the app the
 * new handle rather than a closed one.
 */
export async function openDb(): Promise<OpenOutcome> {
  const current = getDb();
  if (current.isOpen()) return { kind: 'opened', db: current };

  let reusedSingleton = false;
  return openWithRecovery(current.name, (name) => {
    if (!reusedSingleton) {
      reusedSingleton = true;
      return current;
    }
    const replacement = new TendDb(name);
    setDb(replacement);
    return replacement;
  });
}

/**
 * Replaces the singleton. Used by tests to point at a throwaway database, and by
 * the recovery ladder after deleting a corrupt one.
 */
export function setDb(db: TendDb | null): void {
  instance = db;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    instance.close();
    instance = null;
  }
}
