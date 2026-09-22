'use client';

import { useMemo } from 'react';
import { usePrefs } from './use-prefs';
import { useStableLiveQuery } from './use-live';
import { openWork, today } from '@/lib/db/queries';
import { addDays, type Capacity } from '@/lib/workload/capacity';
import { forecast, type DayLoad } from '@/lib/workload/forecast';
import { firstOverdrawn, slackByDay, type DaySlack } from '@/lib/workload/slack';
import { contributions } from '@/lib/workload/estimates';
import { NO_DUE_DAY, type PlainDate, type Task } from '@/lib/db/types';

/**
 * The workload, derived from what is already in memory.
 *
 * One read of the open tasks, and everything else is arithmetic on top. The
 * alternative was a query per surface, and Today, Upcoming and the calendar all
 * want a different slice of the same answer.
 *
 * `openWork` is the board's scan without its top-level filter, bounded at 500
 * and index-bound. The workload needs the children: a part carrying its own
 * deadline and its own estimate is hours that land on a day, and the board's
 * query drops it. Which of those estimates count is
 * `lib/workload/estimates.ts`, so the parent's own figure is not added on top
 * of the parts that priced it.
 */

const NO_TASKS: Task[] = [];

export interface Workload {
  days: DayLoad[];
  byDay: Map<PlainDate, DaySlack>;
  /** The earliest day whose deadlines stopped fitting. */
  overdrawn: DaySlack | null;
  /** Dated open tasks carrying no estimate, so a figure can be read honestly. */
  unestimated: number;
  capacity: Capacity;
}

export function useWorkload(days = 14): Workload {
  const prefs = usePrefs();
  const tasks = useStableLiveQuery(() => openWork(), [], NO_TASKS);

  const dailyMinutes = prefs.dailyCapacityMinutes;
  // Joined so the dependency is a value rather than an array identity.
  const workKey = prefs.workDays.join(',');

  return useMemo(() => {
    const capacity: Capacity = {
      dailyMinutes,
      workDays: workKey === '' ? [] : workKey.split(',').map(Number),
    };

    const from = today();
    const to = addDays(from, days - 1);
    const byDay = slackByDay(tasks, from, capacity);
    const dated = tasks.filter((task) => task._done === 0 && task._dueDay !== NO_DUE_DAY);

    return {
      days: forecast(tasks, from, to, capacity),
      byDay,
      overdrawn: firstOverdrawn(byDay),
      // Read off the same rule and the same set slack uses, so the count beside
      // a figure is a count of what went into it. A parent priced through its
      // parts is not unestimated, which is the case that used to be reported as
      // one dated task with no estimate while three estimated parts sat under it.
      unestimated: [...contributions(dated).values()].filter((c) => c.kind === 'blank').length,
      capacity,
    };
  }, [tasks, dailyMinutes, workKey, days]);
}
