import { NO_DUE_DAY, type PlainDate, type Task } from '@/lib/db/types';
import { capacityBetween, type Capacity } from './capacity';

/**
 * Whether a deadline is still reachable.
 *
 * This is the number the whole phase exists for. A list of due dates tells you
 * what is coming; it does not tell you that Thursday was already lost on Monday.
 *
 * ── The calculation ────────────────────────────────────────────────────────
 *
 * Slack is a property of a *day*, not of a task. For a day D:
 *
 *     slack(D) = capacity(today … D) − estimates of everything due on or before D
 *
 * Negative means that even working every available minute between now and D, the
 * work already committed by D does not fit. Something due by then will slip. It
 * does not say which thing, because the arithmetic cannot know and guessing
 * would be worse than the honest answer.
 *
 * A task's slack is its due day's slack, which is why two tasks due the same day
 * share one figure. That is correct rather than a simplification: they are
 * competing for the same hours.
 *
 * ── What it refuses to pretend ─────────────────────────────────────────────
 *
 * A task with no estimate contributes nothing, and `unestimated` counts it. The
 * alternative is inventing a duration, which would produce a confident number
 * out of a blank field. So the UI can say "9 of 14 have no estimate" and let the
 * figure be read for what it is worth, which is the same choice the grade
 * projection makes about an unmarked final.
 *
 * Overdue work counts against every future day and gets no capacity window of
 * its own, so it drags the whole run negative. That is right: an overdue task
 * is not a task with a small amount of slack.
 */

export interface DaySlack {
  date: PlainDate;
  /** Work minutes between today and this day, inclusive, work days only. */
  capacity: number;
  /** Estimated minutes of every open task due on or before this day. */
  committed: number;
  /** capacity − committed. Negative means something due by now will slip. */
  slack: number;
  /** Open tasks due on or before this day carrying no estimate. */
  unestimated: number;
}

/** Slack for every day that has work due on it, keyed by date. */
export function slackByDay(
  tasks: readonly Task[],
  today: PlainDate,
  capacity: Capacity,
): Map<PlainDate, DaySlack> {
  // Open, dated, top level. A subtask's estimate belongs to its parent's day and
  // counting both would double the load.
  const dated = tasks.filter(
    (task) => task._done === 0 && task._dueDay !== NO_DUE_DAY && task.parentTaskId === '',
  );

  const days = [...new Set(dated.map((task) => task._dueDay))].sort();
  const out = new Map<PlainDate, DaySlack>();

  let committed = 0;
  let unestimated = 0;
  let index = 0;

  // One pass up the sorted days, carrying the running commitment. Recomputing
  // the sum per day would be quadratic over a semester of deadlines.
  const byDay = [...dated].sort((a, b) => a._dueDay.localeCompare(b._dueDay));

  for (const date of days) {
    while (index < byDay.length && byDay[index]!._dueDay <= date) {
      const task = byDay[index]!;
      if (task.estimateMinutes === null) unestimated += 1;
      else committed += task.estimateMinutes;
      index += 1;
    }

    const available = capacityBetween(today, date, capacity);
    out.set(date, {
      date,
      capacity: available,
      committed,
      slack: available - committed,
      unestimated,
    });
  }

  return out;
}

/** The slack of one task's deadline, or null when it has no date. */
export function slackFor(task: Task, byDay: Map<PlainDate, DaySlack>): DaySlack | null {
  if (task._dueDay === NO_DUE_DAY) return null;
  return byDay.get(task._dueDay) ?? null;
}

/**
 * The first day whose deadlines stopped fitting, or null.
 *
 * What a summary line leads with: one date is actionable where a list of
 * per-day figures is a table to read. Named after the thing it answers, which
 * is "when does this stop working".
 */
export function firstOverdrawn(byDay: Map<PlainDate, DaySlack>): DaySlack | null {
  let earliest: DaySlack | null = null;
  for (const day of byDay.values()) {
    if (day.slack >= 0) continue;
    if (earliest === null || day.date < earliest.date) earliest = day;
  }
  return earliest;
}
