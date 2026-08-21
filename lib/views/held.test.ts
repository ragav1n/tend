import { describe, expect, it } from 'vitest';
import { withHeld, type Held } from './held';

/**
 * The placement rule, in isolation.
 *
 * Ticking three things off a filtered list in a row is ordinary use, and it is
 * the case where an index measured against the wrong list shows.
 */

interface Row {
  id: string;
}

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));
const held = (id: string, index: number): Held<Row> => ({ task: { id }, index });

describe('withHeld', () => {
  it('puts one held row back at its index', () => {
    expect(withHeld(rows('a', 'b', 'd', 'e'), [held('c', 2)]).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('keeps three held rows in their own places', () => {
    // The indexes are read off the rendered list, so 'e' is at 4 rather than at
    // 3, which is where the query put it once 'a' and 'c' had gone.
    const shown = withHeld(rows('b', 'd'), [held('a', 0), held('c', 2), held('e', 4)]);
    expect(shown.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('inserts in index order rather than the order they were ticked', () => {
    const shown = withHeld(rows('b', 'd'), [held('e', 4), held('a', 0), held('c', 2)]);
    expect(shown.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('lets the live row win', () => {
    // The logbook still returns a completed task, and two of the same row is
    // worse than none.
    const shown = withHeld(rows('a', 'b'), [held('b', 1)]);
    expect(shown.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('clamps an index past the end of a list that has since shrunk', () => {
    const shown = withHeld(rows('a'), [held('z', 9)]);
    expect(shown.map((r) => r.id)).toEqual(['a', 'z']);
  });

  it('leaves a list with nothing held alone', () => {
    expect(withHeld(rows('a', 'b'), []).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
