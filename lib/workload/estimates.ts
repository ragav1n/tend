import { NO_PARENT, type Task } from '@/lib/db/types';

/**
 * Whose estimate counts toward a workload.
 *
 * Both answers to this have been wrong, and each was wrong in a way that read
 * as fine on screen.
 *
 * Skipping every subtask, which is what the workload did while a subtask could
 * not hold a date of its own, made a project split into three estimated parts
 * read as an empty week. The parts were dropped, and the parent, priced by its
 * parts rather than as a whole, had no figure to drop in. Nine hours of
 * committed work was invisible to the one feature built to show committed work.
 *
 * Counting every task instead double counts the way the old comment feared. A
 * parent estimated at nine hours and broken into three three-hour parts is nine
 * hours of work, not eighteen.
 *
 * So a task's estimate counts on its own day, and a parent whose children carry
 * estimates does not count its own: the children are the same work, priced
 * again in smaller pieces. A checklist with hours written against its items
 * reads the same way.
 */

export type Contribution =
  /** Minutes that land on this task's own day. */
  | { kind: 'minutes'; minutes: number }
  /** Dated work nobody has put a number on. Counted, never guessed at. */
  | { kind: 'blank' }
  /** A parent its children already account for. Adds nothing, and is not blank:
   *  its hours are estimated, on the children's own days. */
  | { kind: 'covered' };

/**
 * What each task contributes, keyed by id.
 *
 * Pass the rows whose estimates the caller is about to count. Which parents are
 * covered is decided from those rows alone, so a child whose estimate would
 * land nowhere covers nothing: cover the parent on the strength of a child the
 * caller then skips, and the parent's figure vanishes with nothing taking its
 * place, which is the bug this whole function exists to undo.
 *
 * One corner is left standing. Finish every estimated child and the parent's own
 * figure counts again, which overstates what is left to do. That is the safe
 * direction for a tool whose job is warning about overcommitment, and a parent
 * whose parts are all done is usually a tick away from being done itself.
 */
export function contributions(tasks: readonly Task[]): Map<string, Contribution> {
  const covered = new Set<string>();
  for (const task of tasks) {
    if (task.parentTaskId !== NO_PARENT && task.estimateMinutes !== null) {
      covered.add(task.parentTaskId);
    }
  }

  const out = new Map<string, Contribution>();
  for (const task of tasks) {
    if (covered.has(task.id)) out.set(task.id, { kind: 'covered' });
    else if (task.estimateMinutes === null) out.set(task.id, { kind: 'blank' });
    else out.set(task.id, { kind: 'minutes', minutes: task.estimateMinutes });
  }
  return out;
}
