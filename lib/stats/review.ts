import { today } from '@/lib/db/queries';
import { shiftDays } from '@/lib/calendar/grid';
import type { FocusSession, Instant, PlainDate, Task } from '@/lib/db/types';

/**
 * What the week looked like.
 *
 * Every function here takes rows and returns numbers, so the review screen owns
 * no arithmetic. The one thing worth stating: days are local calendar days, not
 * UTC ones. A task completed at 8pm on Sunday in New York is Sunday's, and
 * bucketing by the UTC date would move a third of somebody's evenings into the
 * next day and quietly break their streak.
 */

export interface DayStat {
  date: PlainDate;
  completed: number;
  focusSeconds: number;
}

export interface WeekSummary {
  days: DayStat[];
  completed: number;
  focusSeconds: number;
  /** Consecutive days ending today with at least one completion. */
  streak: number;
  /** The busiest day of the week, or null when nothing was finished. */
  best: DayStat | null;
}

/** The local calendar day an instant falls on. */
export function localDay(instant: Instant): PlainDate {
  return today(new Date(instant));
}

/** The `weekStart` weekday on or before `date`. ISO weekdays, 1 Monday. */
export function startOfWeek(date: PlainDate, weekStart: number): PlainDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const iso = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
  return shiftDays(date, -((iso - weekStart + 7) % 7));
}

export function weekDays(start: PlainDate): PlainDate[] {
  return Array.from({ length: 7 }, (_, i) => shiftDays(start, i));
}

/** Local midnight at the start of `date`, and the instant the next one begins. */
export function dayBounds(date: PlainDate): { from: Instant; to: Instant } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { from: from.toISOString(), to: new Date(to.getTime() - 1).toISOString() };
}

/** The window covering a whole week, as instants a range query can use. */
export function weekBounds(start: PlainDate): { from: Instant; to: Instant } {
  return { from: dayBounds(start).from, to: dayBounds(shiftDays(start, 6)).to };
}

export function summarize(
  days: readonly PlainDate[],
  completed: readonly Task[],
  sessions: readonly FocusSession[],
  todayDate = today(),
): WeekSummary {
  const stats = new Map<PlainDate, DayStat>(
    days.map((date) => [date, { date, completed: 0, focusSeconds: 0 }]),
  );

  for (const task of completed) {
    if (task.completedAt === null) continue;
    const day = stats.get(localDay(task.completedAt));
    if (day) day.completed += 1;
  }

  for (const session of sessions) {
    const day = stats.get(localDay(session.startedAt));
    if (day) day.focusSeconds += session.focusedSeconds;
  }

  const list = [...stats.values()];
  const best = list.reduce<DayStat | null>(
    (top, day) => (day.completed > 0 && (top === null || day.completed > top.completed) ? day : top),
    null,
  );

  return {
    days: list,
    completed: list.reduce((sum, day) => sum + day.completed, 0),
    focusSeconds: list.reduce((sum, day) => sum + day.focusSeconds, 0),
    streak: streakLength(completed, todayDate),
    best,
  };
}

/**
 * Consecutive days with at least one completion, counting back from today.
 *
 * Nothing done yet today does not break the streak: the day is not over. So the
 * count starts at today when today has a completion and at yesterday otherwise,
 * which is the only version of this anybody finds fair at 9am.
 */
export function streakLength(completed: readonly Task[], todayDate: PlainDate): number {
  const done = new Set<PlainDate>();
  for (const task of completed) {
    if (task.completedAt !== null) done.add(localDay(task.completedAt));
  }

  let cursor = done.has(todayDate) ? todayDate : shiftDays(todayDate, -1);
  let streak = 0;
  while (done.has(cursor)) {
    streak += 1;
    cursor = shiftDays(cursor, -1);
  }
  return streak;
}

/** Tallest bar in the chart, floored at 1 so an empty week draws flat rather
 *  than dividing by zero. */
export function peak(days: readonly DayStat[]): number {
  return Math.max(1, ...days.map((day) => day.completed));
}
