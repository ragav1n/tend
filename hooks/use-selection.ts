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

  // Refused with no rows to select. Counted rather than asked of the lists,
  // because a list showing its empty state still registers: the bar mounts in
  // the shell now, so shift+S on Settings, or on a Today with nothing due, would
  // otherwise raise an action bar over a screen with a count that can only ever
  // read zero. Mounted by the list, as it used to be, that was impossible by
  // accident, since the empty state returns before the bar renders.
  begin: () => {
    if (get().total > 0) set({ active: true });
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
    settle(set, get);
  },

  forget: (listId) => {
    const lists = new Map(get().lists);
    if (!lists.delete(listId)) return;
    set({ lists, total: rows(lists).length });
    settle(set, get);
  },

  clear: () => set({ ids: NONE.selected, anchor: null }),
}));

/**
 * Brings the selection back in line with what the page is showing.
 *
 * Two jobs. Rows no list holds any more are dropped, and the mode ends once the
 * page holds no rows at all: completing a selection of three out of three empties
 * the list, and an action bar reading "0 selected" over an empty state is a mode
 * nobody asked to still be in. Mounted by the list, the bar used to vanish there
 * and leave the mode quietly switched on behind it.
 *
 * A held row still counts as shown, so the 900ms a completed row lingers for is
 * inside the mode rather than the moment it ends.
 *
 * The identity check on the prune is not a micro-optimisation: every list reports
 * on every change to its order, and a fresh Set each time would re-render every
 * row on the page for a prune that removed nothing.
 */
function settle(
  set: (partial: Partial<SelectionState>) => void,
  get: () => SelectionState,
) {
  const { active, ids, lists } = get();

  if (rows(lists).length === 0) {
    if (active) set({ active: false, ids: NONE.selected, anchor: null });
    return;
  }

  if (ids.size === 0) return;
  const kept = prune(ids, rows(lists));
  if (kept.size !== ids.size) set({ ids: kept });
}
