import { describe, expect, it } from 'vitest';
import { cardAcross, cardAlong, columnBeside, locate } from './cursor';
import type { BoardColumn } from './columns';
import { NO_PROJECT, type Task } from '@/lib/db/types';

/**
 * Where the board's keyboard lands.
 *
 * The interesting cases are the ones a plain index bump gets wrong: an empty
 * column between two full ones, a short column next to a long one, and the
 * difference between the cursor stopping at the last column and a card refusing
 * to move past it.
 */

function task(id: string): Task {
  return {
    id,
    userId: 'u',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    rowVersion: 1,
    projectId: NO_PROJECT,
    parentTaskId: '',
    seriesId: '',
    depth: 0,
    title: id,
    notes: '',
    status: 'inbox',
    priority: 0,
    dueDate: null,
    dueTime: null,
    startDate: null,
    plannedFor: null,
    estimateMinutes: null,
    completedAt: null,
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
  };
}

/** Inbox holds three, Doing is empty, Waiting holds one, Done holds two. */
const columns: BoardColumn[] = [
  { id: 'inbox', title: 'Inbox', tasks: [task('i1'), task('i2'), task('i3')] },
  { id: 'active', title: 'Doing', tasks: [] },
  { id: 'waiting', title: 'Waiting', tasks: [task('w1')] },
  { id: 'done', title: 'Done', tasks: [task('d1'), task('d2')] },
];

describe('locate', () => {
  it('finds a card by id', () => {
    expect(locate(columns, 'i3')).toEqual({ column: 0, row: 2 });
    expect(locate(columns, 'd1')).toEqual({ column: 3, row: 0 });
  });

  it('returns nothing for a card the board is not showing', () => {
    expect(locate(columns, 'gone')).toBeNull();
  });
});

describe('cardAlong', () => {
  it('walks the column', () => {
    expect(cardAlong(columns, 'i1', 1)).toBe('i2');
    expect(cardAlong(columns, 'i2', -1)).toBe('i1');
  });

  it('holds at both ends rather than wrapping', () => {
    expect(cardAlong(columns, 'i1', -1)).toBeNull();
    expect(cardAlong(columns, 'i3', 1)).toBeNull();
  });
});

describe('cardAcross', () => {
  it('steps over an empty column', () => {
    // Doing holds nothing, so right from Inbox reaches Waiting rather than
    // stopping dead on a key that looks broken.
    expect(cardAcross(columns, 'i1', 1)).toBe('w1');
  });

  it('clamps to the last card when the next column is shorter', () => {
    expect(cardAcross(columns, 'i3', 1)).toBe('w1');
  });

  it('keeps the row when the next column is long enough', () => {
    expect(cardAcross(columns, 'i2', 1)).toBe('w1');
    expect(cardAcross(columns, 'd2', -1)).toBe('w1');
    expect(cardAcross(columns, 'd1', -1)).toBe('w1');
  });

  it('holds at both edges of the board', () => {
    expect(cardAcross(columns, 'i1', -1)).toBeNull();
    expect(cardAcross(columns, 'd2', 1)).toBeNull();
  });
});

describe('columnBeside', () => {
  it('names the neighbour, empty or not', () => {
    // The cursor steps over Doing. A card moving into it is the point.
    expect(columnBeside(columns, 'i1', 1)).toBe('active');
    expect(columnBeside(columns, 'w1', -1)).toBe('active');
  });

  it('refuses to move a card off either end', () => {
    expect(columnBeside(columns, 'i1', -1)).toBeNull();
    expect(columnBeside(columns, 'd1', 1)).toBeNull();
  });
});
