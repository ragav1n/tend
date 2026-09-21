import type { PlainDate, Task } from '@/lib/db/types';

/**
 * Whether a task is still waiting for its start date.
 *
 * `startDate` is documented on the row as "hides the task until this date", and
 * until this existed nothing read it. The column was editable in the detail
 * panel, carried forward by every recurrence, and referenced by no query, so a
 * paper deferred to November sat in Today from the day it was captured.
 *
 * Wall clock, like every other date on a task: a task that starts on the 4th
 * starts on the 4th wherever you are standing, so the comparison is two
 * `YYYY-MM-DD` strings and never two instants.
 *
 * The working lists hide a deferred task. Upcoming and the calendar do not,
 * because both are a forward look and a commitment you cannot start yet is
 * still a commitment arriving. Hiding it there would mean deferring a task took
 * it off the only screen that was going to warn you about it.
 */
export function isDeferred(task: Task, day: PlainDate): boolean {
  return task.startDate !== null && task.startDate > day;
}

/** The two halves of a list, in one pass, keeping the order they arrived in. */
export function splitDeferred(
  tasks: readonly Task[],
  day: PlainDate,
): { rows: Task[]; deferred: Task[] } {
  const rows: Task[] = [];
  const deferred: Task[] = [];
  for (const task of tasks) (isDeferred(task, day) ? deferred : rows).push(task);
  return { rows, deferred };
}
