/**
 * What a click adds to a selection.
 *
 * Pure, because the interesting part is the range rule and that rule is easy to
 * get subtly wrong: a shift-click has to extend from the last plain click, not
 * from the last thing that happened to end up selected, or a second shift-click
 * walks the anchor down the list and the range creeps.
 */

export interface Pick {
  selected: ReadonlySet<string>;
  /** Where the next shift-click measures from. */
  anchor: string | null;
}

/** Ids between two rows in list order, both ends included. */
export function rangeBetween(
  order: readonly string[],
  from: string,
  to: string,
): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) return [];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * Fold one click into the selection.
 *
 * A plain click toggles the row and moves the anchor to it. A shift-click adds
 * the run from the anchor and leaves the anchor where it was, so shift-clicking
 * a third row grows or shrinks the same run rather than starting a new one.
 */
export function pick(
  current: Pick,
  order: readonly string[],
  id: string,
  extend: boolean,
): Pick {
  if (extend && current.anchor !== null) {
    const run = rangeBetween(order, current.anchor, id);
    if (run.length > 0) {
      return { selected: new Set([...current.selected, ...run]), anchor: current.anchor };
    }
  }

  const selected = new Set(current.selected);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  return { selected, anchor: id };
}

/**
 * Drop ids the list no longer shows.
 *
 * Completing a selection empties it out of a filtered view one row at a time,
 * and a count of six over a list of two is the kind of thing that makes people
 * stop trusting the button next to it.
 */
export function prune(selected: ReadonlySet<string>, order: readonly string[]): Set<string> {
  const visible = new Set(order);
  return new Set([...selected].filter((id) => visible.has(id)));
}
