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


  // v6 adds areas, which have existed server-side since 0001 so a project could
  // point at one. The list is short and always read whole, so sortKey is the
  // only ordering index it needs.
  //
  // The upgrade clears the sync cursor, and that is the whole point of it.
  // `LOCAL_TABLE.areas` was `null` before this version, so the apply path
  // dropped every area row it was ever sent AND advanced the cursor past it. An
  // area whose row_version sits below the cursor would never be offered again,
  // and every project filed there would show under "No area" forever. Deleting
  // the key restarts the pull from 0, which is safe rather than destructive:
  // `applyPage` is idempotent and `isStale` skips a row it already holds at that
  // version, so a re-pull cannot clobber a pending local edit.
  db.version(6)
    .stores({
      areas: ['id', '_del', 'rowVersion', '[_del+sortKey]'].join(', '),
    })
    .upgrade(async (tx) => {
      // Not through `writeCursor`, which refuses to move the cursor backwards.
      await tx.table('syncMeta').delete('sync.cursor');
    });

  // v7 indexes the cancelled pile.
  //
  // Only `cancelledAt` is added to `tasks`, and only cancelled rows carry a
  // value for it, so this index *is* the cancelled list rather than a filter
  // over every task: IndexedDB leaves a record out of a compound index when any
  // component is null or absent, which is usually the trap and here is the
  // mechanism. No `.upgrade()` for the same reason. Nothing is cancelled yet,
  // and an existing row with no `cancelledAt` is correctly absent.
  db.version(7).stores({
    tasks: [
      'id',
      '_del',
      'projectId',
      'parentTaskId',
      'seriesId',
      'rowVersion',
      '[_del+_done+_dueDay+sortKey]',
      '[_del+_done+_plannedDay+plannedSortKey]',
      '[_del+projectId+_done+sortKey]',
      '[_del+parentTaskId+sortKey]',
      '[_del+_done+completedAt]',
      '[_del+cancelledAt]',
      '*_tagIds',
      '*_words',
    ].join(', '),
  });

  // v8 adds terms, courses and their weighted components, and gives `tasks` an
  // index for "the open work in this course".
  //
  // The upgrade backfills `courseId` and `componentId` to `''` on every task,
  // and it is not optional. IndexedDB leaves a record out of a compound index
  // when any component is absent, so without it every task written before this
  // version would be invisible to the course index. `''` is the same sentinel
  // `projectId` uses for the Inbox, chosen for the same reason: it is a real
  // value that sorts before every uuid.
  //
  // It also clears the sync cursor, and that is the more urgent half.
  // `applyPage` walks `TABLE_ORDER`, and `focus_sessions`, `activity_log` and
  // `saved_views` were in `APPLIERS` and in none of it, so every row of those
  // three was dropped on arrival while the cursor advanced past it. Nothing
  // would offer them again. This is the same repair v6 made for areas, for the
  // same reason, and it is safe rather than destructive: `applyPage` is
  // idempotent and `isStale` skips a row already held at that version, so a
  // re-pull cannot clobber a pending local edit.
  //
  // Chunked with a yield between, because this rewrites every task row and the
  // upgrade runs on the thread that is trying to paint the first list.
  db.version(8)
    .stores({
      terms: ['id', '_del', 'rowVersion', '[_del+sortKey]'].join(', '),
      courses: ['id', '_del', 'rowVersion', '[_del+termId+sortKey]'].join(', '),
      courseComponents: ['id', '_del', 'rowVersion', '[_del+courseId+sortKey]'].join(', '),
      tasks: [
        'id',
        '_del',
        'projectId',
        'parentTaskId',
        'seriesId',
        'rowVersion',
        '[_del+_done+_dueDay+sortKey]',
        '[_del+_done+_plannedDay+plannedSortKey]',
        '[_del+projectId+_done+sortKey]',
        '[_del+parentTaskId+sortKey]',
        '[_del+_done+completedAt]',
        '[_del+cancelledAt]',
        '[_del+courseId+_done+sortKey]',
        '*_tagIds',
        '*_words',
      ].join(', '),
    })
    .upgrade(async (tx) => {
      const tasks = tx.table('tasks');
      const CHUNK = 500;
      let offset = 0;

      for (;;) {
        const rows = await tasks.offset(offset).limit(CHUNK).toArray();
        if (rows.length === 0) break;

        await tasks.bulkPut(
          rows.map((row: Record<string, unknown>) => ({
            ...row,
            courseId: typeof row.courseId === 'string' ? row.courseId : '',
            componentId: typeof row.componentId === 'string' ? row.componentId : '',
            pointsPossible: row.pointsPossible ?? null,
            pointsEarned: row.pointsEarned ?? null,
            gradedAt: row.gradedAt ?? null,
          })),
        );

        offset += rows.length;
        if (rows.length < CHUNK) break;
      }

      // Not through `writeCursor`, which refuses to move the cursor backwards.
      await tx.table('syncMeta').delete('sync.cursor');
    });

  // v9 adds the subscribed feeds and the course events they carry, and gives
  // `tasks` an index on the feed's own identifier.
  //
  // `[_del+feedUid]` holds only imported rows, the same way `[_del+cancelledAt]`
  // holds only cancelled ones: a typed task has no `feedUid`, and IndexedDB
  // leaves a record out of a compound index when a component is null. So the
  // index is "everything that came from a feed" rather than a filter over every
  // task, and no backfill is needed because nothing imported exists yet.
  //
  // The cursor is cleared again. `course_events` is server-owned and arrives
  // only on a pull, so a device whose cursor already sits past the first import
  // would never be offered those rows.
  db.version(9)
    .stores({
      feeds: ['id', '_del', 'rowVersion', '[_del+createdAt]'].join(', '),
      courseEvents: [
        'id',
        '_del',
        'rowVersion',
        'feedUid',
        '[_del+startsOn]',
        '[_del+courseId+startsOn]',
      ].join(', '),
      tasks: [
        'id',
        '_del',
        'projectId',
        'parentTaskId',
        'seriesId',
        'rowVersion',
        '[_del+_done+_dueDay+sortKey]',
        '[_del+_done+_plannedDay+plannedSortKey]',
        '[_del+projectId+_done+sortKey]',
        '[_del+parentTaskId+sortKey]',
        '[_del+_done+completedAt]',
        '[_del+cancelledAt]',
        '[_del+courseId+_done+sortKey]',
        '[_del+feedUid]',
        '*_tagIds',
        '*_words',
      ].join(', '),
    })
    .upgrade(async (tx) => {
      await tx.table('syncMeta').delete('sync.cursor');
    });
}
