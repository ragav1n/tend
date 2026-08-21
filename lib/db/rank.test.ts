import { describe, expect, it } from 'vitest';
import { rankBetween, slotFor } from './rank';

/**
 * Where a row lands when it moves one place.
 *
 * Fractional indexing needs the pair of neighbours the row is moving between,
 * and that pair is not the row it swapped with. Up one place from index 2 means
 * between 0 and 1, which is the arithmetic every hand-written reorder gets wrong
 * the first time.
 */
const keys = ['a0', 'a1', 'a2', 'a3'];

describe('slotFor', () => {
  it('moves a row up between the two above it', () => {
    expect(slotFor(keys, 2, -1)).toEqual({ prev: 'a0', next: 'a1' });
  });

  it('moves a row down between the two below it', () => {
    expect(slotFor(keys, 1, 1)).toEqual({ prev: 'a2', next: 'a3' });
  });

  it('reaches the top of the list with no rank before it', () => {
    expect(slotFor(keys, 1, -1)).toEqual({ prev: null, next: 'a0' });
  });

  it('reaches the bottom with no rank after it', () => {
    expect(slotFor(keys, 2, 1)).toEqual({ prev: 'a3', next: null });
  });

  it('refuses a move off either end', () => {
    expect(slotFor(keys, 0, -1)).toBeNull();
    expect(slotFor(keys, 3, 1)).toBeNull();
    expect(slotFor([], 0, 1)).toBeNull();
  });

  it('gives a key that really sorts into the slot', () => {
    const slot = slotFor(keys, 2, -1)!;
    const key = rankBetween(slot.prev, slot.next);
    expect([...keys.slice(0, 2), key].sort()).toEqual(['a0', key, 'a1'].sort());
    expect(key > 'a0').toBe(true);
    expect(key < 'a1').toBe(true);
  });
});
