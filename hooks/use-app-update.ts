'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getUpdateManager, INITIAL_STATE, type UpdateState } from '@/lib/pwa/updates';

/**
 * Whether this tab is on the deployed version, as React state.
 *
 * `useSyncExternalStore` over the manager rather than an effect copying into
 * `useState`, for the same reason the sync badge does it: the answer changes
 * from service worker events, a fetch and a visibility change, none of which
 * are renders. The server snapshot is the manager's initial state, so nothing
 * mismatches during hydration.
 *
 * Mounting this in two places is fine. The manager is one object for the tab,
 * so a second caller shares its registration, its listeners and its timer.
 */
export interface AppUpdate extends UpdateState {
  /** Asks now, ignoring the hourly throttle. */
  check: () => void;
  /** Hands over to the new version and reloads onto it. */
  apply: () => void;
}

export function useAppUpdate(): AppUpdate {
  const manager = getUpdateManager();

  useEffect(() => {
    manager.start();
  }, [manager]);

  const state = useSyncExternalStore(
    manager.subscribe,
    manager.getState,
    () => INITIAL_STATE,
  );

  const check = useCallback(() => void manager.check({ force: true }), [manager]);
  const apply = useCallback(() => void manager.apply(), [manager]);

  return { ...state, check, apply };
}
