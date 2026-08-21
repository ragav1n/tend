// @vitest-environment jsdom
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useUiStore } from '@/hooks/use-ui';
import { useListCursor } from './use-list-cursor';

/**
 * The cursor against a real DOM, because the cursor IS the DOM.
 *
 * `cursor.test.ts` proves where a move lands. What it cannot prove is that the
 * rows are read in document order, that focus outside the list is not mistaken
 * for a cursor, and that a press behind an open sheet is dropped. All three need
 * an `activeElement`.
 */

function Harness({ onPick, onSubtask = () => {} }: { onPick: (id: string) => void; onSubtask?: (id: string) => void }) {
  const rows = useRef<HTMLUListElement>(null);
  useListCursor(rows, { pick: onPick, addSubtask: onSubtask });

  return (
    <div>
      <button type="button">Select</button>
      <input aria-label="Quick add" />
      <ul ref={rows}>
        {['a', 'b', 'c'].map((id) => (
          <li key={id}>
            <button type="button" data-row-id={id}>
              Task {id}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dispatched on whatever holds focus, which is where a real keydown fires. On
 *  `document` the dispatcher would read every press as coming from nowhere and
 *  the typing guard would never see a field. */
function press(key: string) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function cursor(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset.rowId;
}

beforeEach(() => {
  useUiStore.setState({ openTaskId: null, palette: null, shortcutsOpen: false });
});
afterEach(cleanup);

describe('the list cursor', () => {
  it('walks down and back up the rows', () => {
    render(<Harness onPick={vi.fn()} />);

    press('j');
    expect(cursor()).toBe('a');
    press('j');
    expect(cursor()).toBe('b');
    press('k');
    expect(cursor()).toBe('a');
  });

  it('picks the row it is on', () => {
    const pick = vi.fn();
    render(<Harness onPick={pick} />);

    press('j');
    press('j');
    press('x');

    expect(pick).toHaveBeenCalledWith('b');
  });

  it('picks nothing while the cursor is nowhere', () => {
    const pick = vi.fn();
    render(<Harness onPick={pick} />);

    press('x');

    expect(pick).not.toHaveBeenCalled();
  });

  it('reads focus on another control as no cursor', () => {
    // Tabbing to the Select button and pressing j used to drop the cursor into
    // whichever row the browser happened to focus last.
    render(<Harness onPick={vi.fn()} />);
    screen.getByRole('button', { name: 'Select' }).focus();

    press('j');

    expect(cursor()).toBe('a');
  });

  it('leaves a text field alone', () => {
    render(<Harness onPick={vi.fn()} />);
    const field = screen.getByLabelText('Quick add');
    field.focus();

    press('j');

    expect(document.activeElement).toBe(field);
  });

  it('asks for a subtask on the row it is on', () => {
    const subtask = vi.fn();
    render(<Harness onPick={vi.fn()} onSubtask={subtask} />);

    press('j');
    press('s');

    expect(subtask).toHaveBeenCalledWith('a');
  });

  it('drops a press behind an open sheet', () => {
    // The detail panel traps focus. Moving the cursor under it would pull focus
    // out of the dialog and leave Escape closing a sheet nobody is in.
    render(<Harness onPick={vi.fn()} />);
    press('j');
    useUiStore.setState({ openTaskId: 'a' });

    press('j');

    expect(cursor()).toBe('a');
  });
});
