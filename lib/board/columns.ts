import { compareRank } from '@/lib/db/rank';
import { NO_PROJECT, type Project, type Task, type TaskStatus } from '@/lib/db/types';

/**
 * The board, as pure data.
 *
 * Grouping and the meaning of a drop live here rather than in the component,
 * because a drop is where the two modes stop agreeing: dragging a card to Done
 * completes it, which for a recurring task also generates the next occurrence,
 * while dragging it to another project is an ordinary field write. Getting that
 * distinction wrong is silent, so it gets a test rather than a code review.
 */

export type GroupBy = 'status' | 'project';

export interface BoardColumn {
  /** Also the `data-column` value the drop hit-test reads. */
  id: string;
  title: string;
  tasks: Task[];
}

/** The column that stands in for "no project", since an empty id cannot be an
 *  attribute value the hit-test can tell apart from a miss. */
export const UNFILED = 'unfiled';

/** Statuses as columns, left to right in the order work moves through them. */
export const STATUS_ORDER: { id: TaskStatus; title: string }[] = [
  { id: 'inbox', title: 'Inbox' },
  { id: 'active', title: 'Doing' },
  { id: 'waiting', title: 'Waiting' },
  { id: 'done', title: 'Done' },
];

/**
 * Open work by status, plus what was finished recently.
 *
 * Done is fed separately because "every task I have ever completed" is not a
 * column, it is a logbook, and a board that renders one is unusable by week two.
 */
export function statusBoard(open: readonly Task[], recentlyDone: readonly Task[]): BoardColumn[] {
  return STATUS_ORDER.map(({ id, title }) => ({
    id,
    title,
    tasks:
      id === 'done'
        ? [...recentlyDone]
        : open.filter((task) => task.status === id).sort(compareRank),
  }));
}

/** Open work by project, with the unfiled pile first because it is the one that
 *  needs emptying. */
export function projectBoard(open: readonly Task[], projects: readonly Project[]): BoardColumn[] {
  const unfiled: BoardColumn = {
    id: UNFILED,
    title: 'Inbox',
    tasks: open.filter((task) => task.projectId === NO_PROJECT).sort(compareRank),
  };

  return [
    unfiled,
    ...projects.map((project) => ({
      id: project.id,
      title: project.name,
      tasks: open.filter((task) => task.projectId === project.id).sort(compareRank),
    })),
  ];
}

/** What a drop should do. `complete` exists because completing is not a patch. */
export type Move =
  | { kind: 'none' }
  | { kind: 'complete' }
  | { kind: 'patch'; patch: { status: TaskStatus } | { projectId: string } };

export function moveFor(groupBy: GroupBy, task: Task, columnId: string): Move {
  if (groupBy === 'project') {
    const projectId = columnId === UNFILED ? NO_PROJECT : columnId;
    return task.projectId === projectId ? { kind: 'none' } : { kind: 'patch', patch: { projectId } };
  }

  const status = columnId as TaskStatus;
  if (status === 'done') {
    // Reopening is a plain status write, but completing has to go through the
    // complete path or a recurring task never generates its next occurrence.
    return task._done === 1 ? { kind: 'none' } : { kind: 'complete' };
  }
  return task.status === status ? { kind: 'none' } : { kind: 'patch', patch: { status } };
}
