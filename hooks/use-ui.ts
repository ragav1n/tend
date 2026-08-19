'use client';

import { create } from 'zustand';

/**
 * Ephemeral UI state. Never task data.
 *
 * Which task the detail panel is showing is client state rather than a route.
 * A route would give the panel a URL, but it would also unmount the list under
 * it, and the shared-element transition from the row into the panel needs both
 * on screen at once. Everything else in the app stays a real route.
 *
 * The palette and the shortcuts overlay live here for a different reason: a key
 * press anywhere has to open them, and the listener that hears it sits in the
 * shell rather than beside either component.
 */

/** Commands opens on the full list, search opens straight into the field. The
 *  two are one component: a palette that hides its commands until you clear the
 *  query is one surface with two doors. */
export type PaletteMode = 'commands' | 'search';

interface UiState {
  /** The task the detail panel is showing, or null when it is closed. */
  openTaskId: string | null;
  openTask: (id: string) => void;
  closeTask: () => void;

  palette: PaletteMode | null;
  openPalette: (mode?: PaletteMode) => void;
  closePalette: () => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  /**
   * A shortcut asked for the quick-add field. Set only when the current view has
   * none, so the flag survives the navigation to one that does. QuickAdd clears
   * it as it takes focus.
   */
  quickAddWanted: boolean;
  wantQuickAdd: () => void;
  clearQuickAdd: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  openTaskId: null,
  openTask: (id) => set({ openTaskId: id }),
  closeTask: () => set({ openTaskId: null }),

  palette: null,
  // Opening the palette closes the detail panel. Both are modal, and two stacked
  // dialogs give Escape two meanings.
  openPalette: (mode = 'commands') => set({ palette: mode, openTaskId: null }),
  closePalette: () => set({ palette: null }),

  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

  quickAddWanted: false,
  wantQuickAdd: () => set({ quickAddWanted: true }),
  clearQuickAdd: () => set({ quickAddWanted: false }),
}));
