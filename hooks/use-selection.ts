'use client';

import { create } from 'zustand';
import { pick, prune, type Selection } from '@/lib/selection/range';

/**
 * Which rows are picked, and whether the list is offering to pick any.
 *
 * Ephemeral UI state, so it lives here rather than in Dexie. Selection mode is
 * explicit rather than something a modifier-click falls into, because the row
 * body already means "open this" and a control that means two things depending
 * on a held key is a control most people never find.
 */
interface SelectionState {
  /** The list is showing checkboxes. */
  active: boolean;
  ids: ReadonlySet<string>;
  anchor: string | null;

  begin: () => void;
  /** Leave the mode and drop everything picked. */
  end: () => void;
  /** One click. `order` is the list as shown, which is what a shift-run spans. */
  pick: (id: string, order: readonly string[], extend: boolean) => void;
  selectAll: (order: readonly string[]) => void;
  /** Keep only what the list still shows. */
  prune: (order: readonly string[]) => void;
  clear: () => void;
}

const NONE: Selection = { selected: new Set(), anchor: null };

export const useSelectionStore = create<SelectionState>((set, get) => ({
  active: false,
  ids: NONE.selected,
  anchor: NONE.anchor,

  begin: () => set({ active: true }),
  end: () => set({ active: false, ids: NONE.selected, anchor: null }),

  pick: (id, order, extend) => {
    const next = pick({ selected: get().ids, anchor: get().anchor }, order, id, extend);
    set({ active: true, ids: next.selected, anchor: next.anchor });
  },

  selectAll: (order) => set({ active: true, ids: new Set(order), anchor: order[0] ?? null }),

  prune: (order) => {
    const next = prune(get().ids, order);
    if (next.size !== get().ids.size) set({ ids: next });
  },

  clear: () => set({ ids: NONE.selected, anchor: null }),
}));
