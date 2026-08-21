/**
 * Completed rows, put back where they were.
 *
 * A ticked task keeps its place for the length of the linger, then leaves. The
 * subtlety is what "its place" means once a second row is ticked before the
 * first has gone: the index has to be read against the list on screen, which
 * already holds the earlier row, and not against the query result, which has
 * dropped it. Measured against the query, the second row you tick moves up one
 * slot per row already being held, and the list shuffles under the hand that is
 * still ticking.
 */

export interface Held<T> {
  task: T;
  /** Where it sat in the rendered list at the moment it was completed. */
  index: number;
}

/**
 * The rows to render: the live ones, with the held ones spliced back in.
 *
 * A live row wins, so a list that still returns the completed task (the logbook)
 * shows one row rather than two. Lowest index first, or a held row inserted
 * early shifts the ones after it and they land in each other's places.
 */
export function withHeld<T extends { id: string }>(
  rows: readonly T[],
  held: readonly Held<T>[],
): T[] {
  const shown = [...rows];
  for (const entry of [...held].sort((a, b) => a.index - b.index)) {
    if (shown.some((row) => row.id === entry.task.id)) continue;
    shown.splice(Math.min(entry.index, shown.length), 0, entry.task);
  }
  return shown;
}
