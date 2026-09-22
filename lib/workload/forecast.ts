import { NO_DUE_DAY, type PlainDate, type Task } from '@/lib/db/types';
import { capacityOf, daysBetween, type Capacity } from './capacity';
import { contributions } from './estimates';

/**
 * What each day is carrying.
 *
 * Different from slack, and the difference matters. Slack asks whether a
 * deadline is still reachable. This asks what a particular day has on it, which
 * is the question you have while deciding what to move.
 *
 * Bucketed by `plannedFor` first and `dueDate` second. That ordering is the
 * whole point of having two date columns: `plannedFor` is "I intend to do this
 * on this day" and `dueDate` is when it is owed. A task due Friday and planned
 * for Tuesday is Tuesday's work, and loading Friday with it would tell you your
 * Friday is full when you had already dealt with it.
 */

export type LoadState = 'free' | 'light' | 'full' | 'over';

export interface DayLoad {
  date: PlainDate;
  /** Sum of estimates of tasks landing on this day. */
  minutes: number;
  /** What the day holds. Zero on a day you do not work. */
  capacity: number;
  state: LoadState;
  tasks: number;
  /** Tasks on this day with no estimate, so the number can be read honestly. */
  unestimated: number;
}

/** Past this share of a day, it reads as full rather than as light. */
const LIGHT_CEILING = 0.7;

function stateOf(minutes: number, capacity: number): LoadState {
  if (minutes === 0) return 'free';
  // Anything at all on a day with no capacity is over it, which is what makes
  // work parked on a Saturday visible rather than silently fine.
  if (capacity === 0) return 'over';
  if (minutes > capacity) return 'over';
  if (minutes > capacity * LIGHT_CEILING) return 'full';
  return 'light';
}

/** Which day a task counts against. Null when it belongs to no day. */
export function dayFor(task: Task): PlainDate | null {
  if (task.plannedFor !== null) return task.plannedFor;
  return task._dueDay === NO_DUE_DAY ? null : task._dueDay;
}

export function forecast(
  tasks: readonly Task[],
  from: PlainDate,
  to: PlainDate,
  capacity: Capacity,
): DayLoad[] {
  // Every open task that lands on a day, inside the window or out of it. Which
  // parents their children cover is a fact about the work, not about the
  // fortnight on screen: decided over the window alone, a part due next month
  // would stop covering a parent due this week and the parent's whole figure
  // would reappear here.
  const landing = tasks
    .filter((task) => task._done === 0)
    .map((task) => ({ task, day: dayFor(task) }))
    .filter((row): row is { task: Task; day: PlainDate } => row.day !== null);
  const counted = contributions(landing.map((row) => row.task));

  const minutes = new Map<PlainDate, number>();
  const counts = new Map<PlainDate, number>();
  const blanks = new Map<PlainDate, number>();

  for (const { task, day } of landing) {
    if (day < from || day > to) continue;

    // Counted whatever it contributes. A covered parent is still a thing due
    // on this day, and a day reading "2 tasks, 3h" where one of them is priced
    // through its parts is the honest version of both numbers.
    counts.set(day, (counts.get(day) ?? 0) + 1);

    const contribution = counted.get(task.id);
    if (contribution?.kind === 'blank') blanks.set(day, (blanks.get(day) ?? 0) + 1);
    else if (contribution?.kind === 'minutes') {
      minutes.set(day, (minutes.get(day) ?? 0) + contribution.minutes);
    }
  }

  return daysBetween(from, to).map((date) => {
    const load = minutes.get(date) ?? 0;
    const room = capacityOf(date, capacity);
    return {
      date,
      minutes: load,
      capacity: room,
      state: stateOf(load, room),
      tasks: counts.get(date) ?? 0,
      unestimated: blanks.get(date) ?? 0,
    };
  });
}

/** The busiest day in a run, for a strip that wants to scale its bars. */
export function peakOf(days: readonly DayLoad[]): number {
  return days.reduce((peak, day) => Math.max(peak, day.minutes, day.capacity), 0);
}
