'use client';

import { useLiveQuery } from 'dexie-react-hooks';

/**
 * `useLiveQuery` with a placeholder, so the first render is an empty list rather
 * than `undefined`.
 *
 * Without the third argument every consumer has to branch on undefined, and a
 * list component ends up rendering nothing on the first pass even though the
 * IndexedDB read settles in about 5ms.
 *
 * Known limit: when `deps` change, this returns the placeholder again until the
 * new query settles, so a list briefly empties. Every caller today either has
 * empty deps or is search, where clearing while the query changes is what people
 * expect. When project and tag views land, the fix is to key the list component
 * on the id so React remounts it and the exit animation covers the gap, rather
 * than retaining stale rows behind a ref (which means reading a ref during
 * render, and React does not allow that).
 */
export function useStableLiveQuery<T>(
  querier: () => Promise<T>,
  deps: unknown[],
  initial: T,
): T {
  return useLiveQuery(querier, deps, initial);
}
