// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CHORD_INDEX, TYPING_SAFE, routeFor } from '@/components/shell/keymap';
import { useHotkeys } from './use-hotkeys';

/**
 * The dispatcher against the app's real assembled map.
 *
 * `lib/keys/map.test.ts` already proves `resolveChord` folds two presses into
 * one chord, and it does it with plain objects. What it cannot prove is that a
 * destination added to `nav.ts` actually arrives at the handler, because that
 * crosses three files: the nav list, the assembled index, and the listener that
 * has to hold a prefix between two separate DOM events.
 *
 * Driven here rather than through a browser because the prefix lives in a
 * closure variable inside an effect. A headless Chrome run answers the same
 * question and adds a browser that can auto-update mid-session.
 */

function Harness({ onRun }: { onRun: (id: string) => void }) {
  useHotkeys(CHORD_INDEX, TYPING_SAFE, onRun);
  return null;
}

afterEach(cleanup);

/** One press, with the timestamp the dispatcher measures the sequence with. */
function press(key: string, at: number, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  // jsdom stamps every synthetic event 0, and `resolveChord` compares two of
  // them, so the gap has to be real or every sequence looks instantaneous and
  // the stale-prefix arm is never exercised.
  Object.defineProperty(event, 'timeStamp', { value: at });
  target.dispatchEvent(event);
  return event;
}

describe('a g-sequence through the real map', () => {
  it('sends g then p to Projects', () => {
    const run = vi.fn();
    render(<Harness onRun={run} />);

    press('g', 1000);
    expect(run).not.toHaveBeenCalled();
    press('p', 1200);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toBe('nav:/projects');
    expect(routeFor(run.mock.calls[0]![0] as string)).toBe('/projects');
  });

  it('still sends g then t to Today', () => {
    const run = vi.fn();
    render(<Harness onRun={run} />);

    press('g', 1000);
    press('t', 1100);

    expect(run.mock.calls[0]![0]).toBe('nav:/today');
  });

  it('drops a prefix that went stale and types the second key alone', () => {
    const run = vi.fn();
    render(<Harness onRun={run} />);

    press('g', 1000);
    // Past the window: pressing g, walking away and coming back to press / has
    // to open search rather than complete a sequence.
    press('/', 9000);

    expect(run.mock.calls.map((call) => call[0])).toEqual(['search']);
  });

  it('takes the whole chord back when the prefix is repeated', () => {
    const run = vi.fn();
    render(<Harness onRun={run} />);

    press('g', 1000);
    press('g', 1100);
    press('p', 1200);

    // `g g` matches nothing and clears the prefix, so the p that follows is a
    // bare p, which is bound to nothing either.
    expect(run).not.toHaveBeenCalled();
  });

  it('preventDefault marks the press as handled', () => {
    render(<Harness onRun={() => {}} />);
    press('g', 1000);
    expect(press('p', 1100).defaultPrevented).toBe(true);
  });

  it('will not arm a sequence from inside a text field', () => {
    const run = vi.fn();
    render(<Harness onRun={run} />);

    const input = document.createElement('input');
    document.body.append(input);

    press('g', 1000, input);
    press('p', 1100, input);

    // Typing "gp" into a title is not a request to leave the page.
    expect(run).not.toHaveBeenCalled();
    input.remove();
  });
});
