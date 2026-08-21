/**
 * Where the list cursor lands.
 *
 * Pure, because the rules are the part worth pinning down: what a move does
 * with nothing under the cursor, and what it does at either end. The hook that
 * calls this hands it row elements, the test hands it strings.
 */

/** Every row the cursor can land on, subtasks included. Its value is the id. */
export const ROW_SELECTOR = '[data-row-id]';

/**
 * Rows that can be selected or given a subtask.
 *
 * Only top-level rows carry it. A subtask is not in a list's selection order and
 * would be pruned a tick after being picked, and depth is capped at 1 so a
 * subtask cannot take one of its own.
 */
export const TOP_ROW_SELECTOR = '[data-row-id][data-row-top]';

/** One task list. A page can hold several: the logbook mounts one per day. */
export const LIST_SELECTOR = '[data-task-list]';

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
