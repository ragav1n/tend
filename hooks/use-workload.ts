'use client';

import { useMemo } from 'react';
import { usePrefs } from './use-prefs';
import { useStableLiveQuery } from './use-live';
import { openTasks, today } from '@/lib/db/queries';
import { addDays, type Capacity } from '@/lib/workload/capacity';
import { forecast, type DayLoad } from '@/lib/workload/forecast';
import { firstOverdrawn, slackByDay, type DaySlack } from '@/lib/workload/slack';
import { NO_DUE_DAY, type PlainDate, type Task } from '@/lib/db/types';

/**
 * The workload, derived from what is already in memory.
 *
 * One read of the open tasks, and everything else is arithmetic on top. The
 * alternative was a query per surface, and Today, Upcoming and the calendar all
 * want a different slice of the same answer.
 *
 * `openTasks` is the board's query, bounded at 500 and already index-bound.
 * Reusing it means the workload costs one more live query for the page rather
 * than a new scan, and the bound is the right one: a slack figure over more open
 * tasks than that is not a figure anybody is reading.
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
  const tasks = useStableLiveQuery(() => openTasks(), [], NO_TASKS);

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

    return {
      days: forecast(tasks, from, to, capacity),
      byDay,
      overdrawn: firstOverdrawn(byDay),
      unestimated: tasks.filter(
        (task) =>
          task._done === 0 &&
          task._dueDay !== NO_DUE_DAY &&
          task.parentTaskId === '' &&
          task.estimateMinutes === null,
      ).length,
      capacity,
    };
  }, [tasks, dailyMinutes, workKey, days]);
}
