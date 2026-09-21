import { describe, expect, it } from 'vitest';
import { moveFor, projectBoard, statusBoard, STATUS_ORDER, UNFILED } from './columns';
import { NO_PROJECT, type Project, type Task, type TaskStatus } from '@/lib/db/types';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    userId: 'u',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    rowVersion: 1,
    projectId: NO_PROJECT,
    parentTaskId: '',
    seriesId: '',
    depth: 0,
    title: 'A task',
    notes: '',
    status: 'inbox',
    priority: 0,
    dueDate: null,
    dueTime: null,
    startDate: null,
    plannedFor: null,
    estimateMinutes: null,
    completedAt: null,
    cancelledAt: null,
    courseId: '',
    componentId: '',
    pointsPossible: null,
    pointsEarned: null,
    gradedAt: null,
    cancelReason: null,
    archivedAt: null,
    sortKey: 'a0',
    plannedSortKey: 'a0',
    occurrenceDate: null,
    occurrenceSeq: null,
    _del: 0,
    _done: 0,
    _dueDay: '9999-12-31',
    _plannedDay: '9999-12-31',
    _tagIds: [],
    _words: [],
    ...over,
  };
}

function project(id: string, name: string): Project {
  return {
    id,
    userId: 'u',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    rowVersion: 1,
    areaId: '',
    name,
    notes: '',
    status: 'active',
    color: '#C29B72',
    dueDate: null,
    completedAt: null,
    sortKey: 'a0',
    archivedAt: null,
    _del: 0,
    _archived: 0,
  };
}

describe('statusBoard', () => {
  it('files each task under its status, in the user order', () => {
    const columns = statusBoard(
      [
        task({ id: 'b', status: 'active', sortKey: 'a2' }),
        task({ id: 'a', status: 'active', sortKey: 'a1' }),
        task({ id: 'c', status: 'waiting' }),
        task({ id: 'd', status: 'inbox' }),
      ],
      [],
    );

    expect(columns.map((c) => c.id)).toEqual(STATUS_ORDER.map((s) => s.id));
    expect(columns[1]!.tasks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(columns[2]!.tasks.map((t) => t.id)).toEqual(['c']);
    expect(columns[0]!.tasks.map((t) => t.id)).toEqual(['d']);
  });

  it('takes Done from the recent list rather than from open work', () => {
    const columns = statusBoard(
      [task({ id: 'open' })],
      [task({ id: 'closed', status: 'done', _done: 1 })],
    );
    expect(columns[3]!.tasks.map((t) => t.id)).toEqual(['closed']);
  });

  it('sends Done to the logbook once it is holding a full page', () => {
    const done = [
      task({ id: 'd1', status: 'done', _done: 1 }),
      task({ id: 'd2', status: 'done', _done: 1 }),
    ];

    // Asked for two and given two, so there may well be more behind it. The
    // header count read as the whole truth before this.
    expect(statusBoard([], done, 2)[3]!.more).toEqual({
      label: 'Older in the logbook',
      href: '/logbook',
    });

    // Asked for three and given two, so that is all of it.
    expect(statusBoard([], done, 3)[3]!.more).toBeUndefined();
    // And no other column ever carries one.
    expect(statusBoard([], done, 2).slice(0, 3).map((c) => c.more)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('projectBoard', () => {
  it('leads with the unfiled pile, then the projects in their order', () => {
    const columns = projectBoard(
      [
        task({ id: 'loose' }),
        task({ id: 'filed', projectId: 'p1' }),
        task({ id: 'other', projectId: 'p2' }),
      ],
      [project('p1', 'House'), project('p2', 'Work')],
    );

    expect(columns.map((c) => c.id)).toEqual([UNFILED, 'p1', 'p2']);
    expect(columns.map((c) => c.title)).toEqual(['Inbox', 'House', 'Work']);
    expect(columns[0]!.tasks.map((t) => t.id)).toEqual(['loose']);
    expect(columns[1]!.tasks.map((t) => t.id)).toEqual(['filed']);
  });

  it('gives an empty project an empty column rather than dropping it', () => {
    const columns = projectBoard([], [project('p1', 'House')]);
    expect(columns).toHaveLength(2);
    expect(columns[1]!.tasks).toEqual([]);
  });
});

describe('moveFor', () => {
  it('completes a task dropped on Done, so a recurring one repeats', () => {
    expect(moveFor('status', task(), 'done')).toEqual({ kind: 'complete' });
  });

  it('reopens through a status write, since reopening generates nothing', () => {
    const done = task({ status: 'done', _done: 1 });
    expect(moveFor('status', done, 'active')).toEqual({
      kind: 'patch',
      patch: { status: 'active' },
    });
  });

  it('keeps the column that was dropped on, not a default one', () => {
    const done = task({ status: 'done', _done: 1 });
    expect(moveFor('status', done, 'waiting')).toEqual({
      kind: 'patch',
      patch: { status: 'waiting' },
    });
  });

  it('does nothing when the card lands back where it was', () => {
    for (const status of ['inbox', 'active', 'waiting'] as TaskStatus[]) {
      expect(moveFor('status', task({ status }), status)).toEqual({ kind: 'none' });
    }
    expect(moveFor('status', task({ status: 'done', _done: 1 }), 'done')).toEqual({ kind: 'none' });
    expect(moveFor('project', task({ projectId: 'p1' }), 'p1')).toEqual({ kind: 'none' });
    expect(moveFor('project', task(), UNFILED)).toEqual({ kind: 'none' });
  });

  it('files and unfiles by project, with the sentinel for no project', () => {
    expect(moveFor('project', task(), 'p1')).toEqual({
      kind: 'patch',
      patch: { projectId: 'p1' },
    });
    expect(moveFor('project', task({ projectId: 'p1' }), UNFILED)).toEqual({
      kind: 'patch',
      patch: { projectId: NO_PROJECT },
    });
  });
});
