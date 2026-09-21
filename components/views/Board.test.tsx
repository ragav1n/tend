// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { BoardColumn } from '@/lib/board/columns';
import { NO_DUE_DAY, NO_PROJECT, type Task } from '@/lib/db/types';
import { Board } from './Board';

/**
 * The board from a keyboard.
 *
 * `cursor.test.ts` holds where a move lands. What it cannot hold is the wiring:
 * that a press with no card focused is left alone, that the arrows move real DOM
 * focus, and that shift plus an arrow asks for a move rather than moving the
 * cursor. A card could only be moved by dragging it or by opening a sheet before
 * this, so the keyboard path is the whole point.
 */

// This repo does not enable vitest globals, so testing-library's own auto
// cleanup never registers and renders pile up across cases.
afterEach(cleanup);

let n = 0;
function task(title: string): Task {
  return {
    id: `t${n++}`,
    userId: 'local',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    rowVersion: 0,
    projectId: NO_PROJECT,
    parentTaskId: '',
    seriesId: '',
    depth: 0,
    title,
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
    feedUid: null,
    feedSnapshot: {},
    cancelReason: null,
    archivedAt: null,
    sortKey: `a${n}`,
    plannedSortKey: `a${n}`,
    occurrenceDate: null,
    occurrenceSeq: null,
    _del: 0,
    _done: 0,
    _dueDay: NO_DUE_DAY,
    _plannedDay: NO_DUE_DAY,
    _tagIds: [],
    _words: [],
  };
}

function board(): { columns: BoardColumn[]; ids: Record<string, string> } {
  const inboxOne = task('Inbox one');
  const inboxTwo = task('Inbox two');
  const waiting = task('Waiting one');
  return {
    columns: [
      { id: 'inbox', title: 'Inbox', tasks: [inboxOne, inboxTwo] },
      { id: 'active', title: 'Doing', tasks: [] },
      { id: 'waiting', title: 'Waiting', tasks: [waiting] },
    ],
    ids: { inboxOne: inboxOne.id, inboxTwo: inboxTwo.id, waiting: waiting.id },
  };
}

/** Dispatched on whatever holds focus, which is where a real keydown fires. */
function press(key: string, shift = false) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true }),
  );
}

const cursor = () =>
  (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-card]')?.dataset
    .card;

describe('the board from a keyboard', () => {
  it('walks the cards in a column', () => {
    const { columns, ids } = board();
    render(<Board columns={columns} todayDate="2026-08-21" onMove={vi.fn()} onOpen={vi.fn()} />);

    screen.getByText('Inbox one').closest<HTMLElement>('button')?.focus();
    expect(cursor()).toBe(ids.inboxOne);

    press('ArrowDown');
    expect(cursor()).toBe(ids.inboxTwo);

    // The end holds rather than wrapping back to the top.
    press('ArrowDown');
    expect(cursor()).toBe(ids.inboxTwo);

    press('ArrowUp');
    expect(cursor()).toBe(ids.inboxOne);
  });

  it('steps over an empty column on the way across', () => {
    const { columns, ids } = board();
    render(<Board columns={columns} todayDate="2026-08-21" onMove={vi.fn()} onOpen={vi.fn()} />);

    screen.getByText('Inbox one').closest<HTMLElement>('button')?.focus();
    press('ArrowRight');
    // Doing is empty, so the cursor reaches Waiting rather than stopping on a
    // key that looks broken.
    expect(cursor()).toBe(ids.waiting);

    press('ArrowRight');
    expect(cursor()).toBe(ids.waiting);
  });

  it('moves the card itself with shift held', () => {
    const { columns, ids } = board();
    const onMove = vi.fn();
    render(<Board columns={columns} todayDate="2026-08-21" onMove={onMove} onOpen={vi.fn()} />);

    screen.getByText('Inbox one').closest<HTMLElement>('button')?.focus();
    press('ArrowRight', true);

    // The neighbour, empty or not. Moving work into an empty column is most of
    // what the gesture is for.
    expect(onMove).toHaveBeenCalledWith(ids.inboxOne, 'active');
    // The cursor has not moved. The card is what moved, and focus catches up
    // when the columns come back holding it.
    expect(cursor()).toBe(ids.inboxOne);
  });

  it('refuses to move a card off the end of the board', () => {
    const { columns } = board();
    const onMove = vi.fn();
    render(<Board columns={columns} todayDate="2026-08-21" onMove={onMove} onOpen={vi.fn()} />);

    screen.getByText('Inbox one').closest<HTMLElement>('button')?.focus();
    press('ArrowLeft', true);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('leaves the arrows alone when no card holds the cursor', () => {
    const { columns } = board();
    const onMove = vi.fn();
    render(<Board columns={columns} todayDate="2026-08-21" onMove={onMove} onOpen={vi.fn()} />);

    // Bound any wider than a focused card, these presses would be swallowed by
    // the dispatcher and the page would stop scrolling with the arrow keys.
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(cursor()).toBeUndefined();
  });

  it('follows the card into the column it landed in', () => {
    const { columns, ids } = board();
    const view = render(
      <Board columns={columns} todayDate="2026-08-21" onMove={vi.fn()} onOpen={vi.fn()} />,
    );

    screen.getByText('Inbox one').closest<HTMLElement>('button')?.focus();
    press('ArrowRight', true);

    // What the live query coming back looks like: the card is gone from Inbox
    // and rebuilt in Doing, so the element that had focus no longer exists.
    const moved = columns[0]!.tasks[0]!;
    view.rerender(
      <Board
        columns={[
          { id: 'inbox', title: 'Inbox', tasks: [columns[0]!.tasks[1]!] },
          { id: 'active', title: 'Doing', tasks: [moved] },
          columns[2]!,
        ]}
        todayDate="2026-08-21"
        onMove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(cursor()).toBe(ids.inboxOne);
  });
});
