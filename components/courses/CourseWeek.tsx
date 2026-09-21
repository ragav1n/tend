'use client';

import Link from 'next/link';
import type { CourseWeek as Row } from '@/lib/stats/academic';
import { formatMinutes } from '@/lib/focus/timer';
import { cn } from '@/lib/utils';

/**
 * Where the week went, per course.
 *
 * The rest of Review answers "what did I finish and for how long". Four hours
 * of focus means nothing until you know three of them went to one class and
 * none to the one you are behind on, which is the only reading here that
 * changes what you do next week.
 *
 * The bar is share of the week's focus, not progress toward anything. There is
 * no target to be at 40% of, and drawing one would invent a goal nobody set.
 */
export function CourseWeek({
  rows,
  unattributedSeconds,
}: {
  rows: readonly Row[];
  unattributedSeconds: number;
}) {
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, row) => sum + row.focusedSeconds, 0);

  return (
    <section className="mt-7">
      <h2 className="label mb-2">By course</h2>

      <ul className="space-y-1.5">
        {rows.map((row) => {
          const share = total === 0 ? 0 : (row.focusedSeconds / total) * 100;
          return (
            <li key={row.course.id}>
              <Link
                href={`/courses?c=${row.course.id}`}
                className="block rounded-lg border border-line bg-surface px-3.5 py-2.5"
                style={{ boxShadow: 'var(--shadow-flush)' }}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: row.course.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-hi">
                    {row.course.code}
                  </span>
                  {row.focusedSeconds > 0 && (
                    <span className="tnum shrink-0 text-xs text-text-mid">
                      {formatMinutes(row.focusedSeconds)}
                    </span>
                  )}
                </span>

                {total > 0 && (
                  <span
                    className="mt-2 block h-1 overflow-hidden rounded-full bg-sunken"
                    role="img"
                    aria-label={`${Math.round(share)} percent of the week's focus`}
                  >
                    <span
                      className="block h-full rounded-full bg-olive-400"
                      style={{ width: `${share}%`, backgroundColor: row.course.color }}
                    />
                  </span>
                )}

                <span className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-text-lo">
                  {row.finished > 0 && (
                    <span className="tnum">
                      {row.finished} finished
                    </span>
                  )}
                  {row.possible > 0 && (
                    <span className="tnum">
                      {row.earned} of {row.possible} points graded
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {unattributedSeconds > 0 && (
        // Said rather than spread across the courses. A session with no task on
        // it is real work that nobody can honestly assign.
        <p className={cn('mt-2 px-1 text-xs text-text-faint')}>
          <span className="tnum">{formatMinutes(unattributedSeconds)}</span> focused without a task
          attached, so it is not counted against any course.
        </p>
      )}
    </section>
  );
}
