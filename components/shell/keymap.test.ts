import { describe, expect, it } from 'vitest';
import { ALL_ITEMS } from './nav';
import type { BindingScope } from '@/lib/keys/map';
import { BINDINGS, CHORD_INDEX, routeFor } from './keymap';

/**
 * The assembled map, checked against the nav list it is built from.
 *
 * `map.test.ts` proves the matcher; this proves the real map has no collisions,
 * which is the failure that ships silently: two bindings on one chord means the
 * second is unreachable and nothing errors.
 *
 * A collision is inside a scope, or across two scopes that can be bound at the
 * same time. The calendar and the board both answer the arrow keys and neither
 * is ever on screen with the other, so the same chord standing for two things
 * there is the point rather than a mistake.
 *
 * Checking per scope alone was not enough. Every scope answered for itself and
 * for the global set, and a chord shared by two scopes that are mounted together
 * passed: the list and the selection bar are both live on every task page, and
 * `/calendar` binds `calendar`, `list` and `selection` at once, because the grid
 * has a `TaskList` under it. Nothing clashes today, which is exactly when to put
 * the check in.
 */
const scopeOf = (binding: (typeof BINDINGS)[number]) => binding.scope ?? 'global';

/**
 * Scope pairs that are never bound together, so one chord meaning two things is
 * deliberate.
 *
 * Written as the exception rather than the rule. Listing which pairs *can*
 * coexist would mean a scope added later is checked against nothing until
 * somebody remembers to add its row.
 */
const EXCLUSIVE: ReadonlyArray<readonly [BindingScope, BindingScope]> = [['calendar', 'board']];

/** Dispatchable chords in a scope. `native` ones are taught, never matched. */
const chordsIn = (scope: BindingScope) =>
  BINDINGS.filter((b) => scopeOf(b) === scope && !b.native).map((b) => b.chord);

describe('the app keymap', () => {
  it('gives every chord one meaning inside a scope', () => {
    for (const scope of new Set(BINDINGS.map(scopeOf))) {
      const chords = chordsIn(scope);
      expect(new Set(chords).size, scope).toBe(chords.length);
    }
  });

  it('gives every chord one meaning across two scopes that can both be live', () => {
    const scopes = [...new Set(BINDINGS.map(scopeOf))];
    const exclusive = new Set(EXCLUSIVE.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
    const clashes: string[] = [];

    for (const [index, a] of scopes.entries()) {
      for (const b of scopes.slice(index + 1)) {
        if (exclusive.has(`${a}|${b}`)) continue;
        const held = new Set(chordsIn(a));
        for (const chord of chordsIn(b)) {
          if (held.has(chord)) clashes.push(`${chord} answers in both ${a} and ${b}`);
        }
      }
    }

    expect(clashes).toEqual([]);
  });

  it('names a pair as exclusive only while both scopes exist', () => {
    // A carve-out for a scope nobody binds any more is a carve-out that hides
    // the next real clash.
    const scopes = new Set(BINDINGS.map(scopeOf));
    for (const pair of EXCLUSIVE) {
      for (const scope of pair) expect(scopes.has(scope), scope).toBe(true);
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
