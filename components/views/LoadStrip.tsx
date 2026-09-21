'use client';

import { WarningCircle } from '@phosphor-icons/react/dist/ssr';
import type { DayLoad } from '@/lib/workload/forecast';
import type { DaySlack } from '@/lib/workload/slack';
import { formatWorkMinutes } from '@/lib/workload/capacity';
import { cn } from '@/lib/utils';

/**
 * The week ahead, as bars.
 *
 * A list of due dates tells you what is coming. It does not tell you that
 * Thursday was already lost on Monday, which is the whole reason this exists.
 *
 * Two different statements, so they are separated rather than blended. The bars
 * are per-day load: what that day is carrying. The line underneath is slack:
 * whether a deadline is still reachable at all, which depends on every day
 * before it as well.
 *
 * It says nothing when there is nothing to say. A strip reading "0h" on every
 * day is a row of furniture, and a strip built from tasks that carry no
 * estimates would be a confident claim about a blank field, so it reports how
 * many are missing instead.
 */

const STATE_FILL: Record<DayLoad['state'], string> = {
  free: 'bg-line',
  light: 'bg-olive-400',
  full: 'bg-sand-400',
  over: 'bg-clay-400',
};

export function LoadStrip({
  days,
  overdrawn,
  unestimated,
}: {
  days: readonly DayLoad[];
  /** The first day whose deadlines stopped fitting, if any. */
  overdrawn: DaySlack | null;
  /** Dated open tasks with no estimate, across the whole window. */
  unestimated: number;
}) {
  const loaded = days.filter((day) => day.minutes > 0).length;

  // Nothing estimated anywhere. A row of empty bars teaches nothing, and the
  // one useful thing to say is how to make it work.
  if (loaded === 0) {
    if (unestimated === 0) return null;
    return (
      <p className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-xs text-text-lo">
        Put an estimate on a task and this turns into a workload you can read.{' '}
        <span className="tnum">{unestimated}</span> dated{' '}
        {unestimated === 1 ? 'task has' : 'tasks have'} none.
      </p>
    );
  }

  // Bars scale against the busiest day rather than against capacity, so an
  // overloaded day stays legible instead of clipping at the top.
  const peak = days.reduce((high, day) => Math.max(high, day.minutes, day.capacity), 1);

  return (
    <section className="mb-5" aria-label="Workload for the days ahead">
      <div className="flex items-end gap-1">
        {days.map((day) => (
          <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span
              className="flex h-10 w-full items-end justify-center rounded-sm bg-sunken"
              role="img"
              aria-label={`${day.date}: ${formatWorkMinutes(day.minutes)} against ${formatWorkMinutes(day.capacity)}`}
            >
              <span
                className={cn('w-full rounded-sm', STATE_FILL[day.state])}
                style={{ height: `${Math.max(day.minutes === 0 ? 2 : 8, (day.minutes / peak) * 100)}%` }}
              />
            </span>
            <span className="label !text-[0.5rem]">{weekdayOf(day.date)}</span>
          </div>
        ))}
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-text-lo">
        {overdrawn !== null ? (
          <span className="inline-flex items-center gap-1 text-clay-200">
            <WarningCircle size={13} weight="bold" aria-hidden />
            {/* The number the phase exists for. Said as a date and a shortfall,
                because "you are 2h short by Thursday" is actionable and a
                per-day table is a thing to read. */}
            {formatWorkMinutes(-overdrawn.slack)} short by {dayLabel(overdrawn.date)}
          </span>
        ) : (
          <span className="text-olive-300">Everything ahead fits.</span>
        )}

        {unestimated > 0 && (
          <span className="text-text-faint">
            <span className="tnum">{unestimated}</span> with no estimate
          </span>
        )}
      </p>
    </section>
  );
}

/** One letter, since seven of these sit in a 393px row. */
function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
