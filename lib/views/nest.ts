import type { Task } from '@/lib/db/types';

/**
 * The children a parent still nests, given what its list already renders.
 *
 * A list can hold a parent and one of its children as two separate rows. The
 * queries surface a subtask whose deadline is not its parent's, and a view
 * spanning days shows both: a chapter due Friday and the thesis due in three
 * weeks are both in Upcoming. Nested as well as surfaced, that is the same work
 * twice, and `data-row-id` lands in the DOM twice, which the keyboard cursor
 * collects and walks onto twice.
 *
 * The surfaced copy wins, because it is the one carrying the due date, the
 * priority, the tags and the parent's name. The count on the parent row is
 * unaffected: it describes the task rather than this list, so a parent showing
 * "0/1" with nothing underneath it is telling the truth, and the one child is a
 * row somewhere above.
 */
export function nestedUnder(
  children: Task[] | undefined,
  rendered: ReadonlySet<string>,
): Task[] {
  if (!children) return [];
  return children.filter((child) => !rendered.has(child.id));
}
