import type Dexie from 'dexie';

/**
 * IndexedDB schema history.
 *
 * Rules, all learned the hard way in other projects:
 *
 * - **Every `version(n).stores()` block stays here forever.** Dexie replays them
 *   in order to upgrade an old database. Deleting one strands anybody who has
 *   not opened the app since that version shipped.
 * - **Additive only.** Never reuse a table name with different semantics.
 * - **Adding a derived index needs an `.upgrade()`** that recomputes the derived
 *   fields, in chunks, yielding between them.
 * - Indexed fields may not be `null`, `undefined` or boolean. That is why the
 *   derived fields in `derive.ts` are `0 | 1` and why "no due date" is a date
 *   sentinel rather than null.
 *
 * Compound index ordering is chosen so the leading columns match the query
 * predicate exactly. `_del` leads everything because every user-facing query
 * excludes tombstones, and `_done` comes next because every list is either open
 * items or closed items, never a mix.
 */

export const DATA_LAYER_VERSION = 5;

export function defineSchema(db: Dexie): void {
  db.version(1).stores({
    // Synced tables. Rows are stored close to verbatim, so a column added
    // server-side does not break the local store.
    tasks: [
      'id',
      '_del',
      'projectId',
      'parentTaskId',
      'seriesId',
      'rowVersion',
      // Today, Upcoming, Someday: one range scan over the due day.
      '[_del+_done+_dueDay+sortKey]',
      // Today's hand-arranged plan, which orders independently of due date.
      '[_del+_done+_plannedDay+plannedSortKey]',
      // Project view, top-level rows only.
      '[_del+projectId+_done+sortKey]',
      // A task's subtasks.
      '[_del+parentTaskId+sortKey]',
      // Logbook, newest first.
      '[_del+_done+completedAt]',
      // Tag filter and prefix search.
      '*_tagIds',
      '*_words',
    ].join(', '),

    projects: ['id', '_del', 'rowVersion', '[_del+_archived+sortKey]'].join(', '),
    tags: ['id', '_del', 'rowVersion', '[_del+name]'].join(', '),
    taskTags: ['[taskId+tagId]', 'taskId', 'tagId', 'rowVersion'].join(', '),
    prefs: 'id',

    // Local-only tables. Never pushed, never pulled.

    // ++seq gives a total order for this device, which is the only ordering the
    // push protocol needs. [state+nextAttemptAt] is the claim index.
    outbox: ['++seq', 'mutationId', 'state', '[state+nextAttemptAt]', '[table+entityId]', 'batchId'].join(', '),
    // Mutations the server rejected permanently. Kept so they can be surfaced
    // rather than vanishing.
    deadletter: ['mutationId', 'table', 'entityId', 'createdAt'].join(', '),
    // Fields that lost a per-field merge. Recorded so the UI can say "2 changes
    // from another device replaced yours", though the default is silence.
    conflicts: ['++id', 'table', 'entityId', 'at'].join(', '),
    // Cursor, sync state, auth state, recovery counter.
    syncMeta: 'key',
    // Which reminders already fired locally. Local-only on purpose: syncing it
    // would cause write churn across devices for no benefit.
    reminderState: 'taskId',
  });

  // v2 adds recurrence. A series is fetched by id from the task that points at
  // it, so id plus the tombstone and cursor indexes every synced table needs is
  // the whole index set.
  db.version(2).stores({
    taskSeries: ['id', '_del', 'rowVersion'].join(', '),
  });

  // v3 adds the focus timer's log. Every read of it is a window of time newest
  // first, so startedAt leads the one compound index.
  db.version(3).stores({
    focusSessions: ['id', '_del', 'rowVersion', '[_del+startedAt]'].join(', '),
  });

  // v4 adds the activity log behind undo. The stack asks one question, "the
  // newest entry still standing", so _undone leads createdAt; groupId fetches
  // the rest of the gesture once the newest is known.
  db.version(4).stores({
    activityLog: [
      'id',
      '_del',
      'rowVersion',
      'groupId',
      '[_del+_undone+createdAt]',
      '[_del+entityId+createdAt]',
    ].join(', '),
  });

  // v5 adds saved views. The whole list is read at once, so sortKey is the only
  // ordering index it needs.
  db.version(5).stores({
    savedViews: ['id', '_del', 'rowVersion', '[_del+sortKey]'].join(', '),
  });
}
