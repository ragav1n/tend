'use client';

import { motion } from 'motion/react';
import { SOFT } from '@/lib/motion';
import { peak, type DayStat } from '@/lib/stats/review';
import { formatMinutes } from '@/lib/focus/timer';
import { cn } from '@/lib/utils';

/**
 * Completions per day, as bars.
 *
 * One series. Focus time is the smaller line under each column rather than a
 * second bar, because two series in a chart this size stop being readable at the
 * exact width a phone gives it.
 *
 * The bars grow with `scaleY` from the bottom edge, so nothing animates height
 * and the whole chart stays on the compositor.
 */

const BAR_HEIGHT = 96;

function weekdayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

export function WeekChart({ days, todayDate }: { days: DayStat[]; todayDate: string }) {
  const max = peak(days);

  return (
    <div className="flex items-end gap-1.5">
      {days.map((day) => {
        const isToday = day.date === todayDate;

        return (
          <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="tnum text-[0.625rem] text-text-lo">
              {day.completed > 0 ? day.completed : ''}
            </span>

            <div
              className="relative w-full overflow-hidden rounded-sm bg-sunken"
              style={{ height: BAR_HEIGHT, boxShadow: 'var(--shadow-sunken)' }}
            >
              <motion.div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-full origin-bottom rounded-sm bg-olive-500"
                initial={{ scaleY: 0 }}
                animate={{ scaleY: day.completed / max }}
                transition={SOFT}
              />
            </div>

            <span
              className={cn(
                'label !text-[0.5625rem] !tracking-[0.1em]',
                isToday && '!text-clay-300',
              )}
              suppressHydrationWarning
            >
              {weekdayLabel(day.date)}
            </span>
            <span className="tnum text-[0.5625rem] text-text-lo">
              {day.focusSeconds > 0 ? formatMinutes(day.focusSeconds) : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
