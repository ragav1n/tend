'use client';

import { create } from 'zustand';
import { pick, prune, type Selection } from '@/lib/selection/range';

/**
 * Which rows are picked, and whether the page is offering to pick any.
 *
 * Ephemeral UI state, so it lives here rather than in Dexie. Selection mode is
 * explicit rather than something a modifier-click falls into, because the row
 * body already means "open this" and a control that means two things depending
 * on a held key is a control most people never find.
 *
 * The mode belongs to the page, not to a list, and the registry is what makes
 * that true. Every mounted list reports what it is showing, so a prune drops
 * only rows no list holds any more. Pruned against one list's order, which is
 * what this did, two lists wiped each other's picks a tick after they were
 * made: the logbook mounts a list per day, so x on yesterday cleared today.
 *
 * A shift-run still spans one list, which is why `pick` takes an order rather
 * than reading the registry. The run people mean is the one inside the group
 * they are looking at.
 */
interface SelectionState {
  /** The lists are showing checkboxes. */
  active: boolean;
  ids: ReadonlySet<string>;
  anchor: string | null;
  /** Every mounted list and the top-level rows it shows, keyed by list id. */
  lists: ReadonlyMap<string, readonly string[]>;
  /** Rows on the page across every list. What "more than one to compare" means. */
  total: number;

  begin: () => void;
  /** Leave the mode and drop everything picked. */
  end: () => void;
  /** One click. `order` is the list the row sits in, which is what a shift-run spans. */
  pick: (id: string, order: readonly string[], extend: boolean) => void;
  /** Every row on the page, not just the list the key was pressed in. */
  selectAll: () => void;
  /** A list says what it is showing. Keeps only what some list still shows. */
  report: (listId: string, order: readonly string[]) => void;
  /** A list leaves the page. The mode ends with the last one. */
  forget: (listId: string) => void;
  clear: () => void;
}

const NONE: Selection = { selected: new Set(), anchor: null };
const NO_LISTS: ReadonlyMap<string, readonly string[]> = new Map();

/** Every row on the page, in the order the lists registered. */
function rows(lists: ReadonlyMap<string, readonly string[]>): string[] {
  return [...lists.values()].flat();
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  active: false,
  ids: NONE.selected,
  anchor: NONE.anchor,
  lists: NO_LISTS,
  total: 0,

  // Refused with nothing to select in. The bar mounts in the shell now, so a
  // press of shift+S on the settings page would otherwise raise an action bar
  // over a screen holding no rows, with a count that can only ever read zero.
  begin: () => {
    if (get().lists.size > 0) set({ active: true });
  },
  end: () => set({ active: false, ids: NONE.selected, anchor: null }),

  pick: (id, order, extend) => {
    const next = pick({ selected: get().ids, anchor: get().anchor }, order, id, extend);
    set({ active: true, ids: next.selected, anchor: next.anchor });
  },

  selectAll: () => {
    const all = rows(get().lists);
    set({ active: true, ids: new Set(all), anchor: all[0] ?? null });
  },

  report: (listId, order) => {
    const lists = new Map(get().lists);
    lists.set(listId, order);
    set({ lists, total: rows(lists).length });
    keepVisible(set, get);
  },

  forget: (listId) => {
    const lists = new Map(get().lists);
    if (!lists.delete(listId)) return;
    set({ lists, total: rows(lists).length });

    // The last list going means the view went with it. Carrying the mode to the
    // next screen would leave an action bar over a set of rows it no longer
    // refers to. A sibling leaving is a group closing or its last row moving,
    // and the picks in every other group have to survive that.
    if (lists.size === 0) set({ active: false, ids: NONE.selected, anchor: null });
    else keepVisible(set, get);
  },

  clear: () => set({ ids: NONE.selected, anchor: null }),
}));

/**
 * Drops picked rows no list shows any more.
 *
 * The identity check is not a micro-optimisation: every list reports on every
 * change to its order, and setting a fresh Set each time would re-render every
 * row on the page for a prune that removed nothing.
 */
function keepVisible(
  set: (partial: Partial<SelectionState>) => void,
  get: () => SelectionState,
) {
  const { ids, lists } = get();
  if (ids.size === 0) return;
  const kept = prune(ids, rows(lists));
  if (kept.size !== ids.size) set({ ids: kept });
}
