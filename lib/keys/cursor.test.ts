import { describe, expect, it } from 'vitest';
import { nextRow } from './cursor';

/**
 * The two rules a plain index bump gets wrong.
 *
 * Strings stand in for row elements, which is the point of keeping this pure:
 * the hook hands it whatever the container holds and the rules are the same.
 */
describe('nextRow', () => {
  const rows = ['a', 'b', 'c'];

  it('starts at the top going down and at the bottom going up', () => {
    expect(nextRow(rows, null, 1)).toBe('a');
    expect(nextRow(rows, null, -1)).toBe('c');
  });

  it('steps one row at a time', () => {
    expect(nextRow(rows, 'a', 1)).toBe('b');
    expect(nextRow(rows, 'b', 1)).toBe('c');
    expect(nextRow(rows, 'c', -1)).toBe('b');
  });

  it('holds at either end rather than wrapping', () => {
    // A j on the last of a hundred rows that lands back on the first loses the
    // reader's place, and the only way to notice is to scroll.
    expect(nextRow(rows, 'c', 1)).toBe('c');
    expect(nextRow(rows, 'a', -1)).toBe('a');
  });

  it('treats a row that has left the list as no cursor at all', () => {
    // A completed row unmounts, focus falls to the body, and the next press has
    // to land somewhere rather than nowhere.
    expect(nextRow(rows, 'gone', 1)).toBe('a');
    expect(nextRow(rows, 'gone', -1)).toBe('c');
  });

  it('has nothing to move to in an empty list', () => {
    expect(nextRow([], null, 1)).toBeNull();
    expect(nextRow([], 'a', -1)).toBeNull();
  });
});
