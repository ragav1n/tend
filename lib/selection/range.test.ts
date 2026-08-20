import { describe, expect, it } from 'vitest';
import { pick, prune, rangeBetween, type Selection } from './range';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const empty: Selection = { selected: new Set(), anchor: null };

const ids = (p: Selection) => [...p.selected].sort();

describe('rangeBetween', () => {
  it('runs both ways', () => {
    expect(rangeBetween(ORDER, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(ORDER, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('is a single row when both ends are the same', () => {
    expect(rangeBetween(ORDER, 'c', 'c')).toEqual(['c']);
  });

  it('is empty when an end is not in the list', () => {
    expect(rangeBetween(ORDER, 'b', 'zz')).toEqual([]);
  });
});

describe('pick', () => {
  it('adds then removes on a plain click', () => {
    const one = pick(empty, ORDER, 'b', false);
    expect(ids(one)).toEqual(['b']);
    expect(one.anchor).toBe('b');
    expect(ids(pick(one, ORDER, 'b', false))).toEqual([]);
  });

  it('extends from the anchor', () => {
    const one = pick(empty, ORDER, 'b', false);
    const run = pick(one, ORDER, 'd', true);
    expect(ids(run)).toEqual(['b', 'c', 'd']);
  });

  it('keeps the anchor put, so a second shift-click reshapes one run', () => {
    const one = pick(empty, ORDER, 'b', false);
    const long = pick(one, ORDER, 'e', true);
    expect(long.anchor).toBe('b');
    // Back to d. The run from b is added again; nothing walked the anchor to e,
    // which would have made this select d and e instead.
    const shorter = pick(long, ORDER, 'd', true);
    expect(shorter.anchor).toBe('b');
    expect(ids(shorter)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('keeps what was already selected outside the run', () => {
    const first = pick(empty, ORDER, 'a', false);
    const second = pick(first, ORDER, 'c', false);
    expect(ids(pick(second, ORDER, 'e', true))).toEqual(['a', 'c', 'd', 'e']);
  });

  it('falls back to a toggle when there is no anchor', () => {
    expect(ids(pick(empty, ORDER, 'c', true))).toEqual(['c']);
  });

  it('falls back to a toggle when the anchor has left the list', () => {
    const stale: Selection = { selected: new Set(['zz']), anchor: 'zz' };
    const next = pick(stale, ORDER, 'c', true);
    expect(ids(next)).toEqual(['c', 'zz']);
    expect(next.anchor).toBe('c');
  });
});

describe('prune', () => {
  it('drops what the list no longer shows', () => {
    expect([...prune(new Set(['a', 'zz', 'c']), ORDER)].sort()).toEqual(['a', 'c']);
  });

  it('leaves a fully visible selection alone', () => {
    expect([...prune(new Set(['a', 'c']), ORDER)].sort()).toEqual(['a', 'c']);
  });
});
