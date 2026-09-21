'use client';

import Link from 'next/link';
import { Chalkboard, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import type { Course, Task } from '@/lib/db/types';
import { classesOn, nextUp, whenLabel } from '@/lib/courses/upnext';
import { formatClock } from '@/lib/format/date';
import { cn } from '@/lib/utils';

/**
 * What each course wants next, and what meets today.
 *
 * Today already lists the work. What a list of rows cannot say is "which course
 * am I behind on", which is the shape the question actually comes in: not
 * "what is due" but "which of the four things I am enrolled in wants something
 * first".
 *
 * One line per course, and nothing at all when no course owes anything. An
 * empty strip above a list is furniture, and padding it with courses that are
 * clear makes the ones that are not harder to see.
 */
export function NextUpStrip({
  courses,
  tasks,
  today,
}: {
  courses: readonly Course[];
  tasks: readonly Task[];
  today: string;
}) {
  const rows = nextUp(courses, tasks, today);
  const classes = classesOn(courses, today);

  if (rows.length === 0 && classes.length === 0) return null;

  return (
    <section className="mb-5 space-y-1.5" aria-label="Your courses today">
      {rows.map((row) => {
        const late = row.days < 0;
        return (
          <Link
            key={row.course.id}
            href={`/courses?c=${row.course.id}`}
            className={cn(
              'flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs',
              late ? 'border-clay-400/50 bg-clay-600/5' : 'border-line/60',
            )}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: row.course.color }}
              aria-hidden
            />
            <span className="shrink-0 text-text-hi">{row.course.code}</span>
            <span className="min-w-0 flex-1 truncate text-text-lo">{row.task.title}</span>
            <span
              className={cn('tnum shrink-0', late ? 'text-clay-200' : 'text-text-mid')}
            >
              {late && <WarningCircle size={11} weight="bold" aria-hidden className="mr-1 inline align-[-1px]" />}
              {whenLabel(row.days)}
            </span>
          </Link>
        );
      })}

      {classes.length > 0 && (
        // Quieter than the deadlines, and below them. A class is a fact about
        // the day; a deadline is a decision about it.
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-0.5 text-xs text-text-faint">
          <Chalkboard size={12} aria-hidden />
          {classes.map((each, index) => (
            <span key={`${each.course.id}-${index}`} className="tnum">
              {each.course.code} {formatClock(each.start)}
              {each.location !== '' && ` · ${each.location}`}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
