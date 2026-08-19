import { describe, expect, it } from 'vitest';
import { ALL_ITEMS } from './nav';
import { BINDINGS, CHORD_INDEX, routeFor } from './keymap';

/**
 * The assembled map, checked against the nav list it is built from.
 *
 * `map.test.ts` proves the matcher; this proves the real map has no collisions,
 * which is the failure that ships silently: two bindings on one chord means the
 * second is unreachable and nothing errors.
 */
describe('the app keymap', () => {
  it('gives every chord one meaning', () => {
    const chords = BINDINGS.map((b) => b.chord);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('gives every destination a shortcut', () => {
    const routes = BINDINGS.map((b) => routeFor(b.id)).filter(Boolean);
    expect(new Set(routes)).toEqual(new Set(ALL_ITEMS.map((item) => item.href)));
  });

  it('resolves a sequence to a route', () => {
    expect(routeFor(CHORD_INDEX.get('g t')!)).toBe('/today');
    expect(routeFor(CHORD_INDEX.get('g b')!)).toBe('/board');
  });

  it('leaves the actions alone', () => {
    expect(routeFor('palette')).toBeNull();
  });
});
