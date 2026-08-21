/**
 * Where the list cursor lands.
 *
 * Pure, because the rules are the part worth pinning down: what a move does
 * with nothing under the cursor, and what it does at either end. The hook that
 * calls this hands it row elements, the test hands it strings.
 */

/** The attribute a row's focus target carries. Its value is the task id. */
export const ROW_SELECTOR = '[data-row-id]';

/**
 * The row a move of `delta` reaches.
 *
 * Two rules a plain index bump gets wrong. With nothing under the cursor, a
 * move down starts at the top and a move up starts at the bottom, so the first
 * press always lands somewhere. And the ends hold rather than wrap: a j on the
 * last of a hundred rows that jumps back to the first loses the reader's place,
 * and the only way to find out it happened is to scroll.
 */
export function nextRow<T>(rows: readonly T[], current: T | null, delta: number): T | null {
  if (rows.length === 0) return null;

  const at = current === null ? -1 : rows.indexOf(current);
  if (at === -1) return (delta > 0 ? rows[0] : rows[rows.length - 1]) ?? null;

  const next = at + delta;
  if (next < 0 || next >= rows.length) return rows[at] ?? null;
  return rows[next] ?? null;
}
