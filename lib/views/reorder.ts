import { slotFor } from '@/lib/db/rank';

/**
 * What a hand-arranged list needs to move one of its rows.
 *
 * `reorderTask` had sat in `mutations.ts` with no caller since the day it was
 * written, the same way `reorderProject` had before the projects page grew
 * carets. Both `sortKey` and `plannedSortKey` were decided once, at creation,
 * and never again.
 *
 * The work that is not obvious is the grouping. Today puts overdue work above
 * the rest, so its rendered order is two runs rather than one list, and a row
 * moved from the bottom of the first run to the top of the second would be
 * sorted straight back where it came from. Ranks are read within the run the
 * row belongs to, so the carets at a boundary disable instead of lying.
 *
 * Callers pass rows already grouped, since the group is what the query sorted
 * by. A caller that interleaves two groups gets an answer that is right about
 * the ranks and wrong about the screen.
 *
 * Reading ranks per group means two rows in different groups can end up holding
 * the same rank, because each group generates against its own neighbours. That
 * is safe rather than tolerated: the group decides the order before the rank is
 * consulted, so a collision across groups never shows, and if the two ever land
 * in one group the id tie-break in `compareRank` settles them the same way on
 * every device. Generating against the whole list instead would avoid the
 * collision and bring back the boundary this exists to hold.
 */

/** Which column holds a list's hand-arranged order. */
export type RankField = 'sortKey' | 'plannedSortKey';

/** The only fields a reorder reads. Kept narrow so tests need no whole task. */
export interface Rankable {
  id: string;
  sortKey: string;
  plannedSortKey: string;
}

/** One row's move: the pair of ranks it lands between. */
export interface Move {
  id: string;
  prev: string | null;
  next: string | null;
}

/**
 * Where one row can go.
 *
 * `first` and `last` are about the row's own group, which is what the carets
 * show. A null `up` with `first` false cannot happen; both are carried because
 * the control disables on the flag and acts on the move, and computing the
 * flags from null checks at the call site is how the two drift apart.
 */
export interface RowMove {
  first: boolean;
  last: boolean;
  up: Move | null;
  down: Move | null;
}

/** Rows that never move: one row, or a list with reordering turned off. */
const FIXED: RowMove = { first: true, last: true, up: null, down: null };

/**
 * A move for every row, in the order the rows were given.
 *
 * Parallel to `rows` rather than keyed by id, because the caller already holds
 * the index it is rendering and a map would be a lookup per row to answer a
 * question the position already answers.
 */
export function movesFor<T extends Rankable>(
  rows: readonly T[],
  field: RankField,
  groupOf: (row: T) => string = () => '',
): RowMove[] {
  // Indices per group, in list order. One pass, so a long list costs one walk
  // rather than a scan per row.
  const groups = new Map<string, number[]>();
  for (const [index, row] of rows.entries()) {
    const key = groupOf(row);
    const members = groups.get(key);
    if (members) members.push(index);
    else groups.set(key, [index]);
  }

  const moves: RowMove[] = [];
  for (const [index, row] of rows.entries()) {
    const members = groups.get(groupOf(row));
    if (!members || members.length < 2) {
      moves.push(FIXED);
      continue;
    }

    const keys = members.map((member) => rows[member]![field]);
    const position = members.indexOf(index);
    const up = slotFor(keys, position, -1);
    const down = slotFor(keys, position, 1);

    moves.push({
      first: up === null,
      last: down === null,
      up: up ? { id: row.id, ...up } : null,
      down: down ? { id: row.id, ...down } : null,
    });
  }

  return moves;
}

/**
 * The ranks a row lands between when it is dragged onto another row's slot.
 *
 * The carets move one place at a time, which `slotFor` already answers. A drag
 * crosses any distance, and the rule people expect is that the dragged row
 * displaces the target in the direction it came from: dragged down, it lands
 * after the target; dragged up, it lands before it.
 *
 * Both of those are the same operation once the dragged row is taken out of the
 * list, which is the part worth having a function for. Take it out first and the
 * target sits at `to - 1` when moving down and still at `to` when moving up, so
 * inserting at `to` in the shortened list is correct in both directions. Reading
 * the neighbours off the original list needs two cases and gets one of them
 * wrong for three rows and right for four.
 *
 * Null when the drag went nowhere, or crossed out of the row's own group, which
 * the carets refuse for the same reason.
 */
export function moveToIndex<T extends Rankable>(
  rows: readonly T[],
  from: number,
  to: number,
  field: RankField,
  groupOf: (row: T) => string = () => '',
): Move | null {
  const row = rows[from];
  const target = rows[to];
  if (!row || !target || from === to) return null;
  if (groupOf(row) !== groupOf(target)) return null;

  const members: number[] = [];
  for (const [index, each] of rows.entries()) {
    if (groupOf(each) === groupOf(row)) members.push(index);
  }

  const at = members.indexOf(to);
  const without = members.filter((member) => member !== from).map((member) => rows[member]![field]);

  return {
    id: row.id,
    prev: without[at - 1] ?? null,
    next: without[at] ?? null,
  };
}
