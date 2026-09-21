'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  DEFAULT_SORT,
  readListSort,
  writeListSort,
} from '@/lib/views/list-sort';
import type { ViewSort } from '@/lib/views/filter';

/**
 * The order this route's list is shown in.
 *
 * `useSyncExternalStore` for the reason `use-theme` gives: the source of truth
 * is localStorage, which sits outside React, and seeding state from an effect
 * would be a setState per mount that `react-hooks/set-state-in-effect` rejects
 * here. `getServerSnapshot` answers with the list's own order, which is what the
 * prerendered HTML shows, so hydration agrees and React re-renders once with the
 * stored choice rather than warning about a mismatch.
 */

const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  // `storage` fires in every tab but the one that wrote, so same-tab updates
  // need the local set and cross-tab ones need the event.
  window.addEventListener('storage', notify);
  listeners.add(notify);
  return () => {
    window.removeEventListener('storage', notify);
    listeners.delete(notify);
  };
}

export function useListSort(route: string): {
  sort: ViewSort;
  setSort: (sort: ViewSort) => void;
} {
  const sort = useSyncExternalStore(
    subscribe,
    () => readListSort(route),
    () => DEFAULT_SORT,
  );

  const setSort = useCallback(
    (next: ViewSort) => {
      writeListSort(route, next);
      for (const notify of listeners) notify();
    },
    [route],
  );

  return { sort, setSort };
}
