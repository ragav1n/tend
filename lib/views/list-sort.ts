import type { ViewSort } from './filter';

/**
 * The order a list is shown in, remembered per route on this device.
 *
 * Saved views have carried a `sort` since phase 5, but an ordinary list had no
 * way to change its order: the query decided it and that was the end of it.
 * Google Tasks has had "my order / date / title" on every list for years, and it
 * is the smaller half of what people mean by sorting a list.
 *
 * Per device rather than synced, following the theme. A sort is how you are
 * looking at the list right now, not a property of the work, and syncing it
 * would mean sorting the Inbox by name on a laptop reorders the phone in
 * somebody's pocket.
 *
 * Keyed by route, so `/projects` remembers one choice for every project. A
 * per-project memory would be a key per project id in a store that never gets
 * cleaned up, and nobody sorts one project by name and another by date.
 */

const PREFIX = 'tend.sort.';

const SORTS: readonly ViewSort[] = [
  'manual',
  'due',
  'priority',
  'created',
  'title',
  'pressure',
];

/** The list's own order, which is the one the reorder carets write. */
export const DEFAULT_SORT: ViewSort = 'manual';

/** What each mode is called. "My order" is the phrase people already know. */
export const SORT_LABEL: Record<ViewSort, string> = {
  manual: 'My order',
  due: 'Due date',
  priority: 'Priority',
  created: 'Newest first',
  title: 'Name',
  pressure: 'Tightest first',
};

export function sortStorageKey(route: string): string {
  return `${PREFIX}${route}`;
}

/**
 * Reads the stored choice, falling back to the list's own order.
 *
 * Wrapped because Safari in private mode throws on `localStorage` rather than
 * returning null, and a list that cannot render is worse than a list in the
 * wrong order.
 */
export function readListSort(route: string): ViewSort {
  try {
    const held = window.localStorage.getItem(sortStorageKey(route));
    return SORTS.includes(held as ViewSort) ? (held as ViewSort) : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

/** Writes the choice, clearing the key when it is back to the default. */
export function writeListSort(route: string, sort: ViewSort): void {
  try {
    if (sort === DEFAULT_SORT) window.localStorage.removeItem(sortStorageKey(route));
    else window.localStorage.setItem(sortStorageKey(route), sort);
  } catch {
    // Nothing to do. The choice lasts as long as the page does.
  }
}
