'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A media query as reactive state.
 *
 * `useSyncExternalStore` rather than an effect plus `useState`, because the
 * effect version renders once with the wrong answer and then corrects itself,
 * which on a sheet means it opens from the bottom and jumps to the side.
 *
 * The server snapshot is always false, so the phone layout is what renders
 * during hydration. Every caller today mounts after a tap, well past hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Matches Tailwind's `md`, which is where the shell switches to a sidebar. */
export const MD_QUERY = '(min-width: 48rem)';
