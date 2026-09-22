// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NO_DUE_DAY, type PlainDate, type Task } from '@/lib/db/types';
import { CalendarMonth } from './CalendarMonth';

/**
 * The month grid from a keyboard.
 *
 * `role="grid"` was on this component from the day it shipped and answered no
 * arrow key, which is a promise a screen reader repeats to somebody who then
 * cannot move. The cases worth holding: a move lands on the right day, a move
 * past the edge of the grid asks for a day in the next month rather than
 * stopping, one cell holds the tab stop, and a press with focus outside the grid
 * is left alone so the page still scrolls.
 *
 * The chips have a suite of their own below. A subtask carrying a deadline its
 * parent does not share is on the grid in its own right, and the cell is too
 * narrow for the parent's name, so the tooltip is what says where the work came
 * from. That is invisible in a screenshot.
 */

afterEach(cleanup);

const NO_TASKS = new Map<PlainDate, Task[]>();

function grid(selected: PlainDate, month = '2026-08', onSelect = vi.fn()) {
  const view = render(
    <CalendarMonth
      month={month}
      weekStart={0}
      tasksByDay={NO_TASKS}
      selected={selected}
      todayDate="2026-08-21"
      onSelect={onSelect}
      onMove={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
  return { view, onSelect };
}

function cell(day: PlainDate): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-day-cell="${day}"]`);
  if (!found) throw new Error(`no cell for ${day}`);
  return found;
}

function press(key: string) {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

describe('the month grid from a keyboard', () => {
  it('moves by a day sideways and a week up or down', () => {
    const { onSelect } = grid('2026-08-21');
    cell('2026-08-21').focus();

    press('ArrowRight');
    expect(onSelect).toHaveBeenLastCalledWith('2026-08-22');

    press('ArrowLeft');
    expect(onSelect).toHaveBeenLastCalledWith('2026-08-20');

    press('ArrowDown');
    expect(onSelect).toHaveBeenLastCalledWith('2026-08-28');

    press('ArrowUp');
    expect(onSelect).toHaveBeenLastCalledWith('2026-08-14');
  });

  it('asks for a day past the edge of the grid rather than stopping', () => {
    // The last cell of the August grid. A month is six weeks at most, so the day
    // after it is not rendered anywhere and the parent has to page.
    const { onSelect } = grid('2026-09-05');
    cell('2026-09-05').focus();

    press('ArrowRight');
    expect(onSelect).toHaveBeenLastCalledWith('2026-09-06');
  });

  it('gives the grid one tab stop', () => {
    grid('2026-08-21');
    const stops = [...document.querySelectorAll('[data-day-cell]')].filter(
      (node) => node.getAttribute('tabindex') === '0',
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('data-day-cell')).toBe('2026-08-21');
  });

  it('keeps a tab stop when the month is paged away from the selection', () => {
    // The header's month buttons move the grid and leave the selection where it
    // was, so August 21 can be selected while September is on screen. Keyed off
    // the selection alone, that grid had no way in from the keyboard.
    grid('2026-08-21', '2026-09');
    const stops = [...document.querySelectorAll('[data-day-cell]')].filter(
      (node) => node.getAttribute('tabindex') === '0',
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('data-day-cell')).toBe('2026-09-01');
  });

  it('follows the cursor to the day it landed on after the month pages', () => {
    const { view } = grid('2026-08-31');
    cell('2026-08-31').focus();
    press('ArrowRight');

    // What the parent does with it: selects the day, and pages the grid because
    // the day belongs to another month.
    view.rerender(
      <CalendarMonth
        month="2026-09"
        weekStart={0}
        tasksByDay={NO_TASKS}
        selected="2026-09-01"
        todayDate="2026-08-21"
        onSelect={vi.fn()}
        onMove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect((document.activeElement as HTMLElement).dataset.dayCell).toBe('2026-09-01');
  });

  it('leaves the arrows alone when focus is outside the grid', () => {
    const { onSelect } = grid('2026-08-21');

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    // Swallowed here, the arrow keys would stop scrolling the page.
    expect(event.defaultPrevented).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

/** A row on the grid. Only the fields the cell reads are filled in. */
function task(id: string, title: string, day: PlainDate, parentTaskId = ''): Task {
  return {
    id,
    title,
    parentTaskId,
    status: 'active',
    _done: 0,
    _dueDay: day,
    _plannedDay: NO_DUE_DAY,
  } as Task;
}

describe('the chips in a cell', () => {
  // The stub is this suite's alone, or the file's later cases would inherit a
  // wide screen from whichever one ran first.
  afterEach(() => vi.unstubAllGlobals());

  // The chips are the wide layout; the phone cell shows dots and no titles.
  function wide(rows: Task[], parentTitles?: Map<string, string>) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    return render(
      <CalendarMonth
        month="2026-08"
        weekStart={1}
        tasksByDay={new Map([['2026-08-21', rows]])}
        selected="2026-08-21"
        todayDate="2026-08-21"
        onSelect={vi.fn()}
        onMove={vi.fn()}
        onOpen={vi.fn()}
        parentTitles={parentTitles}
        workDays={[1, 2, 3, 4, 5]}
      />,
    );
  }

  it('names the parent of a subtask chip, since the cell cannot hold it', () => {
    wide(
      [task('t1', 'Draft the intro', '2026-08-21', 'p1')],
      new Map([['p1', 'Submit the report']]),
    );

    expect(screen.getByTitle('Draft the intro, in Submit the report')).toBeTruthy();
  });

  it('leaves a top-level chip titled with its own title alone', () => {
    wide([task('t1', 'Renew the pass', '2026-08-21')]);
    expect(screen.getByTitle('Renew the pass')).toBeTruthy();
  });

  it('counts a subtask in the day the screen reader is told about', () => {
    wide([task('t1', 'Draft the intro', '2026-08-21', 'p1')]);
    // The label used to be built from a list a subtask never reached, so a day
    // holding one open part announced no open work at all.
    expect(screen.getByLabelText('2026-08-21, 1 open task')).toBeTruthy();
  });
});
