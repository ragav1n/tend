// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useSelectionStore } from '@/hooks/use-selection';
import { useUiStore } from '@/hooks/use-ui';
import { useListCursor } from './use-list-cursor';

/**
 * The cursor against a real DOM, because the cursor IS the DOM.
 *
 * `cursor.test.ts` proves where a move lands. What it cannot prove is that the
 * rows are read in document order across every list on the page, that a subtask
 * is walked onto but not acted on, that focus lost is recovered rather than
 * restarted, and that a press behind a modal is dropped. All four need an
 * `activeElement`.
 *
 * Two lists, because one was the bug: bound per list, the first list answered
 * every press and the second was unreachable.
 */

function Harness() {
  useListCursor();
  return (
    <div>
      <button type="button">Select</button>
      <input aria-label="Quick add" />

      <ul data-task-list>
        <li>
          <button type="button" data-row-id="a1" data-row-top>
            Task a1
          </button>
          <ul>
            <li>
              {/* A subtask: walked onto, never picked. */}
              <button type="button" data-row-id="a1-sub">
                Subtask
              </button>
            </li>
          </ul>
        </li>
        <li>
          <button type="button" data-row-id="a2" data-row-top>
            Task a2
          </button>
        </li>
      </ul>

      <ul data-task-list>
        <li>
          <button type="button" data-row-id="b1" data-row-top>
            Task b1
          </button>
        </li>
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

const cursor = () => (document.activeElement as HTMLElement | null)?.dataset.rowId;
const picked = () => [...useSelectionStore.getState().ids];

beforeEach(() => {
  useUiStore.setState({
    openTaskId: null,
    openTaskIntent: null,
    palette: null,
    shortcutsOpen: false,
  });
  useSelectionStore.setState({ active: false, ids: new Set(), anchor: null });
});
afterEach(cleanup);

describe('the list cursor', () => {
  it('walks every row on the page, subtasks and later lists included', () => {
    render(<Harness />);

    press('j');
    expect(cursor()).toBe('a1');
    press('j');
    expect(cursor()).toBe('a1-sub');
    press('j');
    expect(cursor()).toBe('a2');
    // The second list used to be unreachable: one listener per list, and the
    // first one called preventDefault on every press before handling it.
    press('j');
    expect(cursor()).toBe('b1');
    press('j');
    expect(cursor()).toBe('b1');
  });

  it('walks back up across the same boundary', () => {
    render(<Harness />);

    press('k');
    expect(cursor()).toBe('b1');
    press('k');
    expect(cursor()).toBe('a2');
  });

  it('picks the row it is on, spanning the list it sits in', () => {
    render(<Harness />);

    press('j');
    press('j');
    press('j');
    expect(cursor()).toBe('a2');
    press('x');

    expect(picked()).toEqual(['a2']);
    // The anchor a shift-run measures from is this list, not the page.
    expect(useSelectionStore.getState().anchor).toBe('a2');
  });

  it('picks in the second list too', () => {
    render(<Harness />);

    for (let i = 0; i < 4; i += 1) press('j');
    expect(cursor()).toBe('b1');
    press('x');

    expect(picked()).toEqual(['b1']);
  });

  it('leaves a subtask alone', () => {
    render(<Harness />);

    press('j');
    press('j');
    expect(cursor()).toBe('a1-sub');

    press('x');
    press('s');

    // Not in any list's selection order, and depth is capped at 1.
    expect(picked()).toEqual([]);
    expect(useUiStore.getState().openTaskId).toBeNull();
  });

  it('asks for a subtask on a top-level row', () => {
    render(<Harness />);

    press('j');
    press('s');

    expect(useUiStore.getState().openTaskId).toBe('a1');
    expect(useUiStore.getState().openTaskIntent).toBe('subtask');
  });

  it('comes back to the row it was on after focus is taken', () => {
    render(<Harness />);

    press('j');
    press('j');
    press('j');
    expect(cursor()).toBe('a2');

    // A sheet closing with its opener already detached leaves focus here.
    (document.activeElement as HTMLElement).blur();
    press('j');

    // Back to a2 rather than on to b1, and never back to the top of the page.
    expect(cursor()).toBe('a2');
    press('j');
    expect(cursor()).toBe('b1');
  });

  it('reads focus on another control as no cursor', () => {
    render(<Harness />);
    screen.getByRole('button', { name: 'Select' }).focus();

    press('j');

    expect(cursor()).toBe('a1');
  });

  it('does nothing on x while the cursor is nowhere', () => {
    render(<Harness />);

    press('x');

    expect(picked()).toEqual([]);
  });

  it('leaves a text field alone', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Quick add');
    field.focus();

    press('j');

    expect(document.activeElement).toBe(field);
  });

  it('drops a press behind any modal sheet', () => {
    // Not just the three the store knows about. The selection bar's schedule
    // sheet and the More menu are Sheets with no store presence.
    render(<Harness />);
    press('j');

    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    document.body.append(sheet);

    press('j');
    expect(cursor()).toBe('a1');

    sheet.remove();
  });

  it('drops a press behind the palette', () => {
    render(<Harness />);
    press('j');
    useUiStore.setState({ palette: 'commands' });

    press('j');

    expect(cursor()).toBe('a1');
  });
});
