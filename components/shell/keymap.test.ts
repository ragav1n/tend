import { describe, expect, it } from 'vitest';
import { ALL_ITEMS } from './nav';
import { BINDINGS, CHORD_INDEX, routeFor } from './keymap';

/**
 * The assembled map, checked against the nav list it is built from.
 *
 * `map.test.ts` proves the matcher; this proves the real map has no collisions,
 * which is the failure that ships silently: two bindings on one chord means the
 * second is unreachable and nothing errors.
 *
 * A collision is inside a scope, not across the map. The calendar and the board
 * both answer the arrow keys and neither is ever on screen with the other, so
 * the same chord standing for two things is the point rather than a mistake.
 * What cannot happen is two bindings the dispatcher can match in one scope, or a
 * scope reusing a global chord: the global set is bound whatever else is
 * mounted, so that press would have two answers.
 */
const scopeOf = (binding: (typeof BINDINGS)[number]) => binding.scope ?? 'global';

describe('the app keymap', () => {
  it('gives every chord one meaning inside a scope', () => {
    for (const scope of new Set(BINDINGS.map(scopeOf))) {
      const chords = BINDINGS.filter((b) => scopeOf(b) === scope && !b.native).map((b) => b.chord);
      expect(new Set(chords).size, scope).toBe(chords.length);
    }
  });

  it('keeps a scoped chord clear of the global ones', () => {
    const global = new Set(BINDINGS.filter((b) => scopeOf(b) === 'global').map((b) => b.chord));
    const clashing = BINDINGS.filter(
      (b) => scopeOf(b) !== 'global' && !b.native && global.has(b.chord),
    );
    expect(clashing).toEqual([]);
  });

  it('gives every binding one id, since the palette prints chords by id', () => {
    const ids = BINDINGS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every destination a shortcut', () => {
    const routes = BINDINGS.map((b) => routeFor(b.id)).filter(Boolean);
    expect(new Set(routes)).toEqual(new Set(ALL_ITEMS.map((item) => item.href)));
  });

  it('resolves a sequence to a route', () => {
    expect(routeFor(CHORD_INDEX.get('g t')!)).toBe('/today');
    expect(routeFor(CHORD_INDEX.get('g b')!)).toBe('/board');
  });

  it('keeps the list keys out of the app-wide index', () => {
    // j is a letter on Settings. The list binds it while it has rows to walk.
    expect(CHORD_INDEX.has('j')).toBe(false);
    expect(CHORD_INDEX.has('x')).toBe(false);
  });

  it('leaves the actions alone', () => {
    expect(routeFor('palette')).toBeNull();
  });
});
