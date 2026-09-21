import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { setDb, TendDb } from '@/lib/db/client';
import { createSavedView, createTask, ensureTag, setTaskTags } from '@/lib/db/mutations';
import { todayList, today } from '@/lib/db/queries';
import { APPLIERS, applyPage, discardLocal, readCursor, TABLE_ORDER, writeCursor } from './apply';
import type { PullRow, WireTable } from './protocol';

let db: TendDb;
let dbName: string;
let counter = 0;

beforeEach(async () => {
  dbName = `tend_apply_${Date.now()}_${counter++}`;
  db = new TendDb(dbName);
  setDb(db);
  await db.open();
});

afterEach(async () => {
  db.close();
  setDb(null);
  await Dexie.delete(dbName);
});

/** A task row shaped the way sync_pull emits one: snake case, real nulls. */
function taskRow(over: Record<string, unknown> = {}): PullRow {
  return {
    table: 'tasks',
    row: {
      id: 'task-1',
      project_id: null,
      parent_task_id: null,
      series_id: null,
      depth: 0,
      title: 'Buy oat milk',
      notes: '',
      status: 'active',
      priority: 0,
      due_date: null,
      due_time: null,
      start_date: null,
      planned_for: null,
      estimate_minutes: null,
      completed_at: null,
      cancel_reason: null,
      archived_at: null,
      sort_key: 'a0',
      planned_sort_key: 'a0',
      occurrence_date: null,
      occurrence_seq: null,
      created_at: '2026-08-18T00:00:00.000Z',
      updated_at: '2026-08-18T00:00:00.000Z',
      deleted_at: null,
      row_version: 10,
      tag_ids: [],
      ...over,
    },
  };
}

describe('applying a pulled page', () => {
  it('writes the row and turns nulls back into sentinels', async () => {
    const result = await applyPage(db, [taskRow()]);
    expect(result.applied).toBe(1);

    const task = await db.tasks.get('task-1');
    expect(task).toMatchObject({
      title: 'Buy oat milk',
      projectId: '',
      parentTaskId: '',
      seriesId: '',
      rowVersion: 10,
    });
  });

  it('recomputes derived fields rather than trusting the wire', async () => {
    // The server never sends them. Recomputing here through derive.ts is what
    // keeps this path and the optimistic path from disagreeing about Today.
    await applyPage(db, [taskRow({ due_date: today(), status: 'active' })]);

    const task = await db.tasks.get('task-1');
    expect(task?._dueDay).toBe(today());
    expect(task?._done).toBe(0);
    expect(task?._del).toBe(0);
    expect(task?._words).toContain('milk');
    expect(await todayList(today(), db)).toHaveLength(1);
  });

  it('queues nothing back at the server', async () => {
    // Routing a pulled row through the write API would queue it straight back
    // and the two would ping-pong forever.
    await applyPage(db, [taskRow()]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('applies the same page twice with the same result', async () => {
    await applyPage(db, [taskRow()]);
    const second = await applyPage(db, [taskRow()]);

    // The second pass sees a row already at that version and skips it.
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await db.tasks.count()).toBe(1);
  });

  it('takes a newer version and refuses an older one', async () => {
    await applyPage(db, [taskRow({ row_version: 10, title: 'ten' })]);

    await applyPage(db, [taskRow({ row_version: 11, title: 'eleven' })]);
    expect((await db.tasks.get('task-1'))?.title).toBe('eleven');

    // A late response from an abandoned cycle must not overwrite newer state.
    await applyPage(db, [taskRow({ row_version: 9, title: 'nine' })]);
    expect((await db.tasks.get('task-1'))?.title).toBe('eleven');
  });

  it('overwrites a local row that has never been synced', async () => {
    // rowVersion 0 means it has only ever existed on this device, so anything
    // the server says about it is newer by definition.
    const id = await createTask({ title: 'local only' }, db);
    await applyPage(db, [taskRow({ id, title: 'canonical', row_version: 1 })]);
    expect((await db.tasks.get(id))?.title).toBe('canonical');
  });

  it('keeps a column this client is too old to understand', async () => {
    await applyPage(db, [taskRow({ some_future_column: 'keep me' })]);
    const task = await db.tasks.get('task-1');
    expect((task as unknown as Record<string, unknown>).someFutureColumn).toBe('keep me');
  });

  it('applies a tombstone as a soft delete', async () => {
    await applyPage(db, [taskRow({ deleted_at: '2026-08-18T01:00:00.000Z', row_version: 11 })]);
    expect((await db.tasks.get('task-1'))?._del).toBe(1);
    expect(await todayList(today(), db)).toHaveLength(0);
  });
});

describe('tag sets', () => {
  it('replaces the whole set rather than merging it', async () => {
    const id = await createTask({ title: 'Water the plants' }, db);
    const garden = await ensureTag('garden', db);
    const home = await ensureTag('home', db);
    await setTaskTags(id, [garden, home], db);
    expect((await db.tasks.get(id))?._tagIds).toHaveLength(2);

    // Untagged on another device. A merge here is what leaves a task wearing a
    // tag it was removed from somewhere else.
    await applyPage(db, [taskRow({ id, tag_ids: [garden], row_version: 20 })]);

    expect((await db.tasks.get(id))?._tagIds).toEqual([garden]);
    expect(await db.taskTags.where('taskId').equals(id).count()).toBe(1);
  });

  it('keeps the local set when the server sends no tag list at all', async () => {
    // Empty means "no tags" and absent means "the server did not say".
    // Applying the first when you meant the second wipes tags.
    const id = await createTask({ title: 'Water the plants' }, db);
    const garden = await ensureTag('garden', db);
    await setTaskTags(id, [garden], db);

    const row = taskRow({ id, row_version: 20 });
    delete row.row.tag_ids;
    await applyPage(db, [row]);

    expect((await db.tasks.get(id))?._tagIds).toEqual([garden]);
  });
});

describe('page shape', () => {
  it('applies parents before the rows that point at them', async () => {
    const page: PullRow[] = [
      taskRow({ id: 'task-1', project_id: 'project-1' }),
      {
        table: 'projects',
        row: {
          id: 'project-1',
          area_id: null,
          name: 'House',
          notes: '',
          status: 'active',
          color: '#C29B72',
          due_date: null,
          completed_at: null,
          sort_key: 'a0',
          archived_at: null,
          created_at: '2026-08-18T00:00:00.000Z',
          updated_at: '2026-08-18T00:00:00.000Z',
          deleted_at: null,
          row_version: 5,
        },
      },
    ];

    await applyPage(db, page);
    expect((await db.projects.get('project-1'))?.name).toBe('House');
    expect((await db.tasks.get('task-1'))?.projectId).toBe('project-1');
  });

  it('applies an area before the project filed under it', async () => {
    const page: PullRow[] = [
      {
        table: 'projects',
        row: { id: 'project-1', area_id: 'area-1', name: 'Kitchen', sort_key: 'a0', row_version: 5 },
      },
      {
        table: 'areas',
        row: {
          id: 'area-1',
          name: 'House',
          sort_key: 'a0',
          created_at: '2026-08-20T00:00:00.000Z',
          updated_at: '2026-08-20T00:00:00.000Z',
          deleted_at: null,
          row_version: 3,
        },
      },
    ];

    await applyPage(db, page);
    expect((await db.areas.get('area-1'))?.name).toBe('House');
    expect((await db.areas.get('area-1'))?._del).toBe(0);
    expect((await db.projects.get('project-1'))?.areaId).toBe('area-1');
  });

  it('ignores a table it has no local home for', async () => {
    // A server that grew a table before this client shipped is deploy skew,
    // not a reason to halt sync.
    const result = await applyPage(db, [
      { table: 'habits' as WireTable, row: { id: 'habit-1', name: 'Floss', row_version: 3 } },
      taskRow(),
    ]);
    expect(result.applied).toBe(1);
  });

  it('handles an empty page', async () => {
    expect(await applyPage(db, [])).toEqual({ applied: 0, skipped: 0 });
  });

  it('applies more rows than fit in one chunk', async () => {
    const page = Array.from({ length: 1_200 }, (_, i) =>
      taskRow({ id: `task-${i}`, sort_key: `a${i}` }),
    );
    const result = await applyPage(db, page);
    expect(result.applied).toBe(1_200);
    expect(await db.tasks.count()).toBe(1_200);
  });
});

describe('the cursor', () => {
  it('starts at zero, meaning this device has never synced', async () => {
    expect(await readCursor(db)).toBe(0);
  });

  it('advances', async () => {
    await writeCursor(db, 42);
    expect(await readCursor(db)).toBe(42);
  });

  it('never goes backwards', async () => {
    // A late response carrying an older cursor would make the next pull re-send
    // rows that were already applied.
    await writeCursor(db, 42);
    await writeCursor(db, 7);
    expect(await readCursor(db)).toBe(42);
  });
});

/**
 * Dropping a local row that lost a uniqueness race.
 *
 * `pushOnce` reports the row as discarded whether or not anything happened, so
 * a table with no arm here leaves the duplicate in Dexie forever and says it
 * cleaned up. Three tables were missing one at once.
 */
describe('discardLocal', () => {
  it('drops a task and its tag joins', async () => {
    const tag = await ensureTag('work', db);
    const id = await createTask({ title: 'Draft the deck', tagIds: [tag] }, db);
    expect(await db.taskTags.where('taskId').equals(id).count()).toBe(1);

    await discardLocal(db, 'tasks', id);
    expect(await db.tasks.get(id)).toBeUndefined();
    expect(await db.taskTags.where('taskId').equals(id).count()).toBe(0);
  });

  it('drops a saved view, which the sidebar would otherwise list twice', async () => {
    const id = await createSavedView({ name: 'Hot list' }, db);
    await discardLocal(db, 'savedViews', id);
    expect(await db.savedViews.get(id)).toBeUndefined();
  });

  it('drops an activity entry', async () => {
    const id = await createTask({ title: 'Anything' }, db);
    const entry = (await db.activityLog.toArray()).find((e) => e.entityId === id)!;
    await discardLocal(db, 'activityLog', entry.id);
    expect(await db.activityLog.get(entry.id)).toBeUndefined();
  });

  it('drops a focus session', async () => {
    const { startFocusSession } = await import('@/lib/db/mutations');
    const id = await startFocusSession({ plannedMinutes: 25 }, db);
    await discardLocal(db, 'focusSessions', id);
    expect(await db.focusSessions.get(id)).toBeUndefined();
  });

  it('has an arm for every entity table, checked at runtime as well as by tsc', async () => {
    // prefs is the one table with nothing to drop: the signup trigger owns that
    // row and nothing can race it.
    const tables = [
      'tasks', 'taskTags', 'projects', 'tags', 'taskSeries',
      'focusSessions', 'activityLog', 'savedViews', 'prefs',
    ] as const;
    for (const table of tables) {
      // A missing arm now throws rather than returning quietly, so an id that
      // matches nothing is the only thing that should be a no-op.
      await expect(discardLocal(db, table, 'nothing-with-this-id')).resolves.toBeUndefined();
    }
  });
});

describe('the v6 upgrade', () => {
  /**
   * `LOCAL_TABLE.areas` was `null` before areas had a local table, so the apply
   * path dropped every area row it was ever handed AND let the cursor advance
   * past it. Nothing would offer those rows again, so a project filed under one
   * would sit in "No area" on that device forever while another device showed it
   * correctly.
   *
   * Clearing the cursor on the upgrade is what closes it. Safe rather than
   * destructive: `isStale` skips a row already held at that version, so the
   * re-pull cannot overwrite a pending local edit.
   */
  const legacyName = () => `tend_v5_${Date.now()}_${counter++}`;

  it('clears the sync cursor so the areas it dropped come back', async () => {
    const name = legacyName();

    // A v5 database, which is what an existing install is. Only the two stores
    // this case reads are declared: Dexie applies version blocks above the
    // installed number, so the rest of the schema is not what is under test.
    const legacy = new Dexie(name);
    legacy.version(5).stores({ syncMeta: 'key', areas: 'id' });
    await legacy.open();
    await legacy.table('syncMeta').put({ key: 'sync.cursor', value: 4_812 });
    legacy.close();

    const upgraded = new TendDb(name);
    await upgraded.open();
    try {
      expect(await readCursor(upgraded)).toBe(0);
    } finally {
      upgraded.close();
      await Dexie.delete(name);
    }
  });

  it('leaves a database created fresh at v6 with a cursor it can keep', async () => {
    // The upgrade only runs on the way past 5, so a new install never pays for
    // it and a cursor written after opening is not wiped on the next open.
    const name = legacyName();
    const first = new TendDb(name);
    await first.open();
    await writeCursor(first, 99);
    first.close();

    const second = new TendDb(name);
    await second.open();
    try {
      expect(await readCursor(second)).toBe(99);
    } finally {
      second.close();
      await Dexie.delete(name);
    }
  });
});

describe('every table with an applier is actually applied', () => {
  /**
   * `applyPage` walks `TABLE_ORDER`, not `APPLIERS`. A table in the second and
   * missing from the first is dropped in silence: not applied, not counted as
   * skipped, and the cursor advances past it, so nothing ever offers those rows
   * again. It is the same failure the v6 upgrade below repairs for areas.
   *
   * It had happened three more times before this test existed. `focus_sessions`,
   * `activity_log` and `saved_views` each had a working applier and an entry in
   * `APPLIERS`, and none of them was in `TABLE_ORDER`, so they pushed up and
   * never came back down: a saved view never reached a second device, and the
   * weekly review on a laptop could not see focus time from a phone.
   */
  it('lists every applier in TABLE_ORDER', () => {
    const missing = Object.keys(APPLIERS).filter(
      (table) => !TABLE_ORDER.includes(table as WireTable),
    );
    expect(missing).toEqual([]);
  });

  it('names no table in TABLE_ORDER that cannot be applied', () => {
    // The other direction. An entry with no applier is dead weight that reads
    // as coverage.
    const orphans = TABLE_ORDER.filter((table) => APPLIERS[table] === undefined);
    expect(orphans).toEqual([]);
  });

  it('applies a saved view arriving from another device', async () => {
    const result = await applyPage(db, [
      {
        table: 'saved_views',
        row: {
          id: 'view-1',
          name: 'Due this week',
          icon: 'Funnel',
          filter: {},
          sort: 'due',
          pinned: true,
          sort_key: 'a0',
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
          deleted_at: null,
          row_version: 7,
        },
      },
    ]);

    expect(result.applied).toBe(1);
    expect((await db.savedViews.toArray()).map((v) => v.name)).toEqual(['Due this week']);
  });

  it('applies a focus session arriving from another device', async () => {
    const result = await applyPage(db, [
      {
        table: 'focus_sessions',
        row: {
          id: 'session-1',
          task_id: null,
          started_at: '2026-09-01T09:00:00.000Z',
          ended_at: '2026-09-01T09:25:00.000Z',
          planned_minutes: 25,
          focused_seconds: 1500,
          created_at: '2026-09-01T09:00:00.000Z',
          updated_at: '2026-09-01T09:25:00.000Z',
          deleted_at: null,
          row_version: 8,
        },
      },
    ]);

    expect(result.applied).toBe(1);
    expect(await db.focusSessions.count()).toBe(1);
  });

  it('applies a course and the task that points at it, parents first', async () => {
    const result = await applyPage(db, [
      taskRow({ id: 'task-9', course_id: 'course-1', row_version: 11 }),
      {
        table: 'courses',
        row: {
          id: 'course-1',
          term_id: null,
          code: 'CS 6035',
          name: 'Intro to Information Security',
          color: '#8D321F',
          credit_hours: 3,
          instructor: '',
          meetings: [],
          grade_scale: [],
          status: 'active',
          notes: '',
          sort_key: 'a0',
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
          deleted_at: null,
          row_version: 10,
        },
      },
    ]);

    expect(result.applied).toBe(2);
    expect((await db.courses.toArray()).map((c) => c.code)).toEqual(['CS 6035']);
    expect((await db.tasks.get('task-9'))!.courseId).toBe('course-1');
  });
});

describe('the v8 upgrade', () => {
  /**
   * The same repair v6 made for areas, for the three tables that were dropped
   * the same way. A device that has been syncing since phase 4 holds a cursor
   * well past every focus session, activity entry and saved view the server ever
   * offered it, and nothing would offer them again.
   *
   * It also backfills the two course sentinels onto every existing task, without
   * which those rows are absent from `[_del+courseId+_done+sortKey]`: IndexedDB
   * leaves a record out of a compound index when any component is missing.
   */
  const legacyName = () => `tend_v7_${Date.now()}_${counter++}`;

  it('clears the cursor so the rows it dropped are offered again', async () => {
    const name = legacyName();

    const legacy = new Dexie(name);
    legacy.version(7).stores({ syncMeta: 'key', tasks: 'id' });
    await legacy.open();
    await legacy.table('syncMeta').put({ key: 'sync.cursor', value: 91_204 });
    legacy.close();

    const upgraded = new TendDb(name);
    await upgraded.open();
    try {
      expect(await readCursor(upgraded)).toBe(0);
    } finally {
      upgraded.close();
      await Dexie.delete(name);
    }
  });

  it('backfills the course sentinels onto a task written before v8', async () => {
    const name = legacyName();

    const legacy = new Dexie(name);
    legacy.version(7).stores({ syncMeta: 'key', tasks: 'id' });
    await legacy.open();
    await legacy.table('tasks').put({
      id: 'old-task',
      title: 'Written before courses existed',
      _del: 0,
      _done: 0,
      sortKey: 'a0',
    });
    legacy.close();

    const upgraded = new TendDb(name);
    await upgraded.open();
    try {
      const row = await upgraded.tasks.get('old-task');
      expect(row!.courseId).toBe('');
      expect(row!.componentId).toBe('');
      // And it is reachable through the new index, which is the point.
      const byCourse = await upgraded.tasks
        .where('[_del+courseId+_done+sortKey]')
        .between([0, '', 0, ''], [0, '', 0, '￿'], true, true)
        .toArray();
      expect(byCourse.map((t) => t.id)).toEqual(['old-task']);
    } finally {
      upgraded.close();
      await Dexie.delete(name);
    }
  });
});
