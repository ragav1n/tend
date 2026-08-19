import {
  ACTIONS,
  chordIndex,
  inScope,
  navBindings,
  SELECTION_ACTIONS,
  typingSafe,
  type Binding,
} from '@/lib/keys/map';
import { ALL_ITEMS } from './nav';

/**
 * The app's keyboard map, assembled.
 *
 * The destinations come from `nav.ts` so a new view gets a shortcut by adding a
 * letter to the row that already exists, and the rest come from `lib/keys/map`.
 * Everything that needs the map reads it from here: the dispatcher, the
 * shortcuts overlay, and the palette, which prints the chord beside the command
 * it stands for.
 */

/** How a nav binding's id names its route. */
export const NAV_PREFIX = 'nav:';

/** Everything, in the order the overlay lists it. */
export const BINDINGS: Binding[] = [...navBindings(ALL_ITEMS), ...ACTIONS, ...SELECTION_ACTIONS];

/** Only the global ones. The selection bar binds its own while it exists. */
export const CHORD_INDEX = chordIndex(inScope(BINDINGS, 'global'));
export const TYPING_SAFE = typingSafe(BINDINGS);

/** binding id to chord, for anything that wants to print the shortcut. */
export const CHORD_FOR: ReadonlyMap<string, string> = new Map(
  BINDINGS.map((binding) => [binding.id, binding.chord]),
);

/** The route a nav binding goes to, or null for everything else. */
export function routeFor(id: string): string | null {
  return id.startsWith(NAV_PREFIX) ? id.slice(NAV_PREFIX.length) : null;
}
