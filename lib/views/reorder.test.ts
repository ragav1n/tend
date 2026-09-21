import { describe, expect, it } from 'vitest';
import { movesFor, moveToIndex, type Rankable } from './reorder';

function row(id: string, sortKey: string, plannedSortKey = sortKey): Rankable {
  return { id, sortKey, plannedSortKey };
}

const FOUR = [row('a', 'a0'), row('b', 'a1'), row('c', 'a2'), row('d', 'a3')];

describe('movesFor', () => {
  it('gives the first row no way up and the last no way down', () => {
    const moves = movesFor(FOUR, 'sortKey');
    expect(moves[0]!.first).toBe(true);
    expect(moves[0]!.up).toBeNull();
    expect(moves[3]!.last).toBe(true);
    expect(moves[3]!.down).toBeNull();
  });

  it('lands a row moved up between the two above it, not beside its swap', () => {
    // The off-by-one `slotFor` exists for. Moving c up puts it between a and b.
    expect(movesFor(FOUR, 'sortKey')[2]!.up).toEqual({ id: 'c', prev: 'a0', next: 'a1' });
  });

  it('lands a row moved down between the two below it', () => {
    expect(movesFor(FOUR, 'sortKey')[1]!.down).toEqual({ id: 'b', prev: 'a2', next: 'a3' });
  });

  it('opens the end of the list when a row moves onto it', () => {
    expect(movesFor(FOUR, 'sortKey')[1]!.up).toEqual({ id: 'b', prev: null, next: 'a0' });
    expect(movesFor(FOUR, 'sortKey')[2]!.down).toEqual({ id: 'c', prev: 'a3', next: null });
  });

  it('reads the planned column when that is the list order', () => {
    const rows = [row('a', 'z0', 'a0'), row('b', 'z1', 'a1'), row('c', 'z2', 'a2')];
    expect(movesFor(rows, 'plannedSortKey')[2]!.up).toEqual({ id: 'c', prev: 'a0', next: 'a1' });
  });

  it('holds one row still, because a list of one has no order to change', () => {
    expect(movesFor([row('a', 'a0')], 'sortKey')).toEqual([
      { first: true, last: true, up: null, down: null },
    ]);
  });

  it('holds an empty list still', () => {
    expect(movesFor([], 'sortKey')).toEqual([]);
  });

  it('keeps a row inside its own group', () => {
    // Today's shape: overdue first, then the rest. The last overdue row has
    // nowhere to go down, or the sort would put it straight back.
    const rows = [row('a', 'a0'), row('b', 'a1'), row('c', 'a2'), row('d', 'a3')];
    const overdue = (r: Rankable) => (r.id === 'a' || r.id === 'b' ? 'over' : 'rest');
    const moves = movesFor(rows, 'sortKey', overdue);

    expect(moves[1]!.last).toBe(true);
    expect(moves[1]!.down).toBeNull();
    expect(moves[2]!.first).toBe(true);
    expect(moves[2]!.up).toBeNull();
  });

  it('reads ranks from inside the group, not from the whole list', () => {
    const rows = [row('a', 'a0'), row('b', 'a1'), row('c', 'a2'), row('d', 'a3')];
    const half = (r: Rankable) => (r.id === 'a' || r.id === 'b' ? 'over' : 'rest');
    // d moving up inside its group lands above c, so it opens the group's top
    // rather than reaching for b's rank.
    expect(movesFor(rows, 'sortKey', half)[3]!.up).toEqual({ id: 'd', prev: null, next: 'a2' });
  });

  it('holds a group of one still while its neighbours move', () => {
    const rows = [row('a', 'a0'), row('b', 'a1'), row('c', 'a2')];
    const alone = (r: Rankable) => (r.id === 'c' ? 'solo' : 'pair');
    const moves = movesFor(rows, 'sortKey', alone);

    expect(moves[2]).toEqual({ first: true, last: true, up: null, down: null });
    expect(moves[0]!.down).toEqual({ id: 'a', prev: 'a1', next: null });
  });
});

describe('moveToIndex', () => {
  it('lands a row dragged down after the row it was dropped on', () => {
    // a onto b: a displaces b upward, so a sits between b and c.
    expect(moveToIndex(FOUR, 0, 1, 'sortKey')).toEqual({ id: 'a', prev: 'a1', next: 'a2' });
  });

  it('lands a row dragged up before the row it was dropped on', () => {
    // c onto b: c displaces b downward, so c sits between a and b.
    expect(moveToIndex(FOUR, 2, 1, 'sortKey')).toEqual({ id: 'c', prev: 'a0', next: 'a1' });
  });

  it('crosses several rows in one move', () => {
    expect(moveToIndex(FOUR, 0, 3, 'sortKey')).toEqual({ id: 'a', prev: 'a3', next: null });
    expect(moveToIndex(FOUR, 3, 0, 'sortKey')).toEqual({ id: 'd', prev: null, next: 'a0' });
  });

  it('answers nothing for a drag that went nowhere', () => {
    expect(moveToIndex(FOUR, 2, 2, 'sortKey')).toBeNull();
  });

  it('answers nothing for a drop off the list', () => {
    expect(moveToIndex(FOUR, 0, 9, 'sortKey')).toBeNull();
    expect(moveToIndex(FOUR, -1, 1, 'sortKey')).toBeNull();
  });

  it('refuses a drop into another group', () => {
    const half = (r: Rankable) => (r.id === 'a' || r.id === 'b' ? 'over' : 'rest');
    expect(moveToIndex(FOUR, 1, 2, 'sortKey', half)).toBeNull();
    expect(moveToIndex(FOUR, 2, 1, 'sortKey', half)).toBeNull();
  });

  it('reads ranks from inside the group', () => {
    const rows = [row('a', 'a0'), row('b', 'a1'), row('c', 'a2'), row('d', 'a3')];
    const half = (r: Rankable) => (r.id === 'a' || r.id === 'b' ? 'over' : 'rest');
    // d onto c, both in the second group, so d opens the top of that group.
    expect(moveToIndex(rows, 3, 2, 'sortKey', half)).toEqual({ id: 'd', prev: null, next: 'a2' });
  });

  it('reads the planned column when that is the list order', () => {
    const rows = [row('a', 'z9', 'a0'), row('b', 'z8', 'a1'), row('c', 'z7', 'a2')];
    expect(moveToIndex(rows, 0, 2, 'plannedSortKey')).toEqual({ id: 'a', prev: 'a2', next: null });
  });

  it('agrees with the carets on a one-place move', () => {
    // The two paths write the same slot, or dragging a row one place would land
    // it somewhere the caret would not.
    for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 2], [2, 1], [1, 0]] as const) {
      const drag = moveToIndex(FOUR, from, to, 'sortKey');
      const caret = movesFor(FOUR, 'sortKey')[from]![to > from ? 'down' : 'up'];
      expect(drag, `${from} to ${to}`).toEqual(caret);
    }
  });
});
