'use client';

import { create } from 'zustand';

/**
 * Ephemeral UI state. Never task data.
 *
 * Which task the detail panel is showing is client state rather than a route.
 * A route would give the panel a URL, but it would also unmount the list under
 * it, and the shared-element transition from the row into the panel needs both
 * on screen at once. Everything else in the app stays a real route.
 */
interface UiState {
  /** The task the detail panel is showing, or null when it is closed. */
  openTaskId: string | null;
  openTask: (id: string) => void;
  closeTask: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  openTaskId: null,
  openTask: (id) => set({ openTaskId: id }),
  closeTask: () => set({ openTaskId: null }),
}));
