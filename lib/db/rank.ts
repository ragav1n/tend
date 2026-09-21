import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Ordering via fractional indexing.
 *
 * Float ranks run out of precision after roughly 50 inserts into the same slot,
 * and integer gap ranks need a multi-row renumber transaction that an offline
 * batch cannot perform safely. A fractional index string lets a disconnected
 * device insert between two neighbours by touching exactly one row, so two
 * devices reordering different parts of a list never collide.
 *
 * The matching Postgres column is `sort_key text collate "C"`. That collation is
 * mandatory: the default ICU collation does not order ASCII the way JavaScript
 * `<` does, so without it a server ORDER BY silently disagrees with the client's
 * local sort of the same rows.
 */

/** Rank for the first item in an empty list. */
export function rankFirst(): string {
  return generateKeyBetween(null, null);
}

/** Rank that sorts before everything currently in the list. */
export function rankBefore(first: string | null): string {
  return generateKeyBetween(null, first);
}

/** Rank that sorts after everything currently in the list. */
export function rankAfter(last: string | null): string {
  return generateKeyBetween(last, null);
}

/**
 * Rank between two neighbours. Pass null for either end.
 * Callers must pass them in list order; `prev < next` is required.
 */
export function rankBetween(prev: string | null, next: string | null): string {
  return generateKeyBetween(prev, next);
}

/** N ranks between two neighbours, for a bulk insert or a paste. */
export function ranksBetween(
  prev: string | null,
  next: string | null,
  count: number,
): string[] {
  return generateNKeysBetween(prev, next, count);
}

/**
 * Keys grow by roughly one character per insert into the same slot, so a list
 * that gets reordered thousands of times in one spot eventually carries long
 * keys. Past this length the list is rebalanced in the background as a normal
 * batch of mutations.
 */
export const REBALANCE_THRESHOLD = 40;

export function needsRebalance(keys: readonly string[]): boolean {
  return keys.some((k) => k.length > REBALANCE_THRESHOLD);
}

/**
 * Deterministic comparator matching Postgres `ORDER BY sort_key COLLATE "C", id`.
 * The id tie-break matters: if two offline devices generate the identical key
 * for the same slot, without it the two would disagree on order forever.
 */
export function compareRank(
  a: { sortKey: string; id: string },
  b: { sortKey: string; id: string },
): number {
  return byRank(a.sortKey, a.id, b.sortKey, b.id);
}

/**
 * The same order over `plannedSortKey`, which is the column the Today list
 * arranges by hand. Separate rather than a field argument, because every caller
 * hands one of these straight to `Array.sort` and a third parameter there is a
 * parameter the sort never passes.
 */
export function comparePlannedRank(
  a: { plannedSortKey: string; id: string },
  b: { plannedSortKey: string; id: string },
): number {
  return byRank(a.plannedSortKey, a.id, b.plannedSortKey, b.id);
}

function byRank(aKey: string, aId: string, bKey: string, bId: string): number {
  if (aKey < bKey) return -1;
  if (aKey > bKey) return 1;
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

/**
 * The two ranks a row lands between when it moves `delta` places in a list.
 *
 * The off-by-one here is the whole reason this is a function. Moving a row up one
 * place puts it between the two rows above it, not next to the one it swapped
 * with, and reading the pair off the wrong indices produces a move that looks
 * right for three rows and wrong for four.
 *
 * Null for a move that runs off either end, which is what the caller checks
 * rather than clamping: a disabled button and a silent no-op are different.
 */
export function slotFor(
  keys: readonly string[],
  index: number,
  delta: number,
): { prev: string | null; next: string | null } | null {
  const target = index + delta;
  if (delta === 0 || index < 0 || target < 0 || target >= keys.length) return null;
  return delta < 0
    ? { prev: keys[target - 1] ?? null, next: keys[target] ?? null }
    : { prev: keys[target] ?? null, next: keys[target + 1] ?? null };
}
