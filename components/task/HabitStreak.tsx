'use client';

import { useMemo } from 'react';
import { useSeriesOccurrences } from '@/hooks/use-tasks';
import { today } from '@/lib/db/queries';
import type { RecurrenceRule } from '@/lib/recurrence';
import { habitStats } from '@/lib/stats/habit';
import { cn } from '@/lib/utils';

/**
 * The run a repeating task is on, and four weeks of it as dots.
 *
 * Olive, because a finished day is state. Hidden until something is finished,
 * since a row of empty dots under a task made a minute ago reads as a scolding.
 */
export function HabitStreak({ seriesId, rule }: { seriesId: string; rule: RecurrenceRule }) {
  const occurrences = useSeriesOccurrences(seriesId);
  const stats = useMemo(() => habitStats(rule, occurrences, today()), [rule, occurrences]);

  if (stats.best === 0) return null;

  const doneDays = stats.days.filter((d) => d.done).length;

  return (
    <div className="space-y-1.5">
      <p className="tnum text-xs text-text-mid">
        <span className={cn(stats.current > 0 && 'text-olive-300')}>
          {stats.current === 0 ? 'No streak' : `${stats.current} in a row`}
        </span>
        <span className="text-text-lo"> · best {stats.best}</span>
      </p>
      <div
        role="img"
        aria-label={`Done on ${doneDays} of the last ${stats.days.length} days`}
        className="flex justify-between gap-0.5"
      >
        {stats.days.map((d, i) => (
          <span
            key={d.date}
            title={d.date}
            className={cn(
              'size-1.5 rounded-full',
              d.done ? 'bg-olive-400' : 'bg-line',
              i === stats.days.length - 1 && 'ring-1 ring-line-bright ring-offset-1 ring-offset-sunken',
            )}
          />
        ))}
      </div>
    </div>
  );
}
