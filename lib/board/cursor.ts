import type { BoardColumn } from './columns';

/**
 * Where a keyboard move on the board lands.
 *
 * Pure, because the rules are the part that is easy to get wrong: what a
 * sideways move does when the next column is empty, what a vertical move does at
 * the ends, and the difference between moving the cursor and moving the card.
 * The component hands these columns and a task id and gets back an id to focus.
 *
 * Two rules run through all of it. Ends hold rather than wrap, the same choice
 * the list cursor made: a press that jumps from the last column back to the
 * first loses where the reader was. And a card is addressed by its id rather
 * than by a position, because the columns are rebuilt from a live query on every
 * write and a held index would point at whatever moved into that slot.
 */

/** The card the cursor sits on. Also the drag handle and the focus target. */
export const CARD_SELECTOR = '[data-card]';

/** Where a card sits: column index, then row inside it. */
export interface CardSpot {
  column: number;
  row: number;
}

export function locate(columns: readonly BoardColumn[], taskId: string): CardSpot | null {
  for (const [column, { tasks }] of columns.entries()) {
    const row = tasks.findIndex((task) => task.id === taskId);
    if (row !== -1) return { column, row };
  }
  return null;
}

/** The card `delta` rows away in the same column, or null at either end. */
export function cardAlong(
  columns: readonly BoardColumn[],
  taskId: string,
  delta: number,
): string | null {
  const spot = locate(columns, taskId);
  if (!spot) return null;
  const tasks = columns[spot.column]?.tasks ?? [];
  return tasks[spot.row + delta]?.id ?? null;
}

/**
 * The card a sideways move lands on.
 *
 * Empty columns are stepped over. A board grouped by status usually has one, and
 * a cursor that stops dead at Waiting-with-nothing-in-it reads as a broken key
 * rather than as an empty column. The row is kept where it can be and clamped to
 * the last card where it cannot, so moving out of a long column and back does
 * not walk the cursor to the top.
 */
export function cardAcross(
  columns: readonly BoardColumn[],
  taskId: string,
  delta: number,
): string | null {
  const spot = locate(columns, taskId);
  if (!spot) return null;

  const step = delta > 0 ? 1 : -1;
  for (let at = spot.column + step; at >= 0 && at < columns.length; at += step) {
    const tasks = columns[at]?.tasks ?? [];
    if (tasks.length === 0) continue;
    return (tasks[spot.row] ?? tasks[tasks.length - 1])?.id ?? null;
  }
  return null;
}

/**
 * The column a card moves into, or null when it is already at that end.
 *
 * Empty columns count here, unlike the cursor: moving work into a column that
 * has nothing in it is most of what the gesture is for.
 */
export function columnBeside(
  columns: readonly BoardColumn[],
  taskId: string,
  delta: number,
): string | null {
  const spot = locate(columns, taskId);
  if (!spot) return null;
  return columns[spot.column + delta]?.id ?? null;
}
