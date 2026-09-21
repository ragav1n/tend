// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { LONG_PRESS_MS, SLOP_PX, useLongPressDrag } from './use-long-press-drag';

/**
 * The arming rules, which are the whole gesture.
 *
 * Motion's drag itself is not under test here: `controls.start` needs a real
 * pointer and a layout, and what goes wrong in practice is the timing. Every
 * case below is a bug that shipped at some point in this file's short life: a
 * press that scrolled still armed, and a press that armed and was lifted in
 * place never let go, because `onDragEnd` never fires for a drag that motion
 * never started.
 */

let started: unknown[] = [];

vi.mock('motion/react', () => ({
  useDragControls: () => ({ start: (event: unknown) => started.push(event) }),
}));

function Row({ enabled = true }: { enabled?: boolean }) {
  const { armed, handlers, release } = useLongPressDrag(enabled);
  return (
    <div
      data-testid="row"
      data-armed={armed ? 'yes' : 'no'}
      onPointerDown={handlers.onPointerDown}
      onContextMenu={handlers.onContextMenu}
      // Stands in for motion's own drag end.
      onDoubleClick={release}
    />
  );
}

function press(node: HTMLElement, x = 100, y = 100) {
  node.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, isPrimary: true }),
  );
}

function moveTo(x: number, y: number) {
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
}

function lift() {
  window.dispatchEvent(new PointerEvent('pointerup', {}));
}

const armed = (node: HTMLElement) => node.dataset.armed === 'yes';

beforeEach(() => {
  started = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('a long press picking up a row', () => {
  it('arms once the finger has rested long enough', () => {
    const { getByTestId } = render(<Row />);
    const row = getByTestId('row');

    act(() => press(row));
    expect(armed(row)).toBe(false);

    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(armed(row)).toBe(true);
    expect(started).toHaveLength(1);
  });

  it('stays still for a tap', () => {
    const { getByTestId } = render(<Row />);
    const row = getByTestId('row');

    act(() => press(row));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS - 50));
    act(() => lift());
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));

    expect(armed(row)).toBe(false);
    expect(started).toEqual([]);
  });

  it('gives the gesture up to a scroll', () => {
    const { getByTestId } = render(<Row />);
    const row = getByTestId('row');

    act(() => press(row, 100, 100));
    act(() => moveTo(100, 100 + SLOP_PX + 1));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS * 2));

    expect(armed(row)).toBe(false);
    expect(started).toEqual([]);
  });

  it('ignores a jitter under the slop', () => {
    const { getByTestId } = render(<Row />);
    const row = getByTestId('row');

    act(() => press(row, 100, 100));
    act(() => moveTo(103, 102));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));

    expect(armed(row)).toBe(true);
  });

  it('lets go of a row lifted in place, with no drag end to rely on', () => {
    // A press that wins and is then lifted without travelling leaves motion
    // with no drag to end. Without a release of its own the row kept its lift
    // and its z-index for the rest of the session.
    const { getByTestId } = render(<Row />);
    const row = getByTestId('row');

    act(() => press(row));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(armed(row)).toBe(true);

    act(() => lift());
    expect(armed(row)).toBe(false);
  });

  it('stops travel from re-cancelling once the press has won', () => {
    const { getByTestId } = render(<Row />);
    const row = getByTestId('row');

    act(() => press(row, 100, 100));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    // This is the drag now, not a scroll.
    act(() => moveTo(100, 400));

    expect(armed(row)).toBe(true);
  });

  it('does nothing at all on a list with no order to change', () => {
    const { getByTestId } = render(<Row enabled={false} />);
    const row = getByTestId('row');

    act(() => press(row));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS * 2));

    expect(armed(row)).toBe(false);
    expect(started).toEqual([]);
  });

  it('holds the browser menu back only while a press is live', () => {
    const { getByTestId } = render(<Row />);
    const row = getByTestId('row');

    const idle = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => void row.dispatchEvent(idle));
    expect(idle.defaultPrevented).toBe(false);

    act(() => press(row));
    const pending = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => void row.dispatchEvent(pending));
    expect(pending.defaultPrevented).toBe(true);
  });

  it('leaves no timer behind when the row unmounts mid-press', () => {
    const { getByTestId, unmount } = render(<Row />);
    act(() => press(getByTestId('row')));

    unmount();
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS * 2));

    // Armed nothing, and started nothing, because the row is gone.
    expect(started).toEqual([]);
  });
});
