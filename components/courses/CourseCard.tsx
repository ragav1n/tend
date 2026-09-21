'use client';

import Link from 'next/link';
import { CalendarBlank, PencilSimple, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { formatDueLabel } from '@/lib/format/date';
import { today } from '@/lib/db/queries';
import type { Course } from '@/lib/db/types';
import type { CourseCount } from '@/lib/db/queries';
import { cn } from '@/lib/utils';
import { ReorderStack } from '@/components/ui/ReorderStack';
import { meetingLabel } from './MeetingRows';

/**
 * One course on the index.
 *
 * The code leads and the title follows it, because the code is what you call the
 * course and a list read by title is a list you have to translate.
 *
 * The next deadline is the number the card exists for. An open count tells you
 * a course has work in it, which you knew; the date tells you which course to
 * open, which is the actual question.
 */
export function CourseCard({
  course,
  count,
  onEdit,
  first,
  last,
  onMove,
}: {
  course: Course;
  count: CourseCount | undefined;
  onEdit: () => void;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const todayDate = today();
  const nextDue = count?.nextDue ?? null;
  const overdue = nextDue !== null && nextDue < todayDate;
  const open = count?.open ?? 0;

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3',
        course.status !== 'active' && 'opacity-60',
      )}
      style={{ boxShadow: 'var(--shadow-flush)' }}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: course.color }}
        aria-hidden
      />

      <Link href={`/courses?c=${course.id}`} className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[0.9375rem] leading-snug text-text-hi">{course.code}</span>
          {course.name && (
            <span className="truncate text-xs text-text-lo">{course.name}</span>
          )}
        </span>

        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {nextDue !== null && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                overdue ? 'text-clay-200' : 'text-text-lo',
              )}
            >
              {overdue ? (
                <WarningCircle size={13} weight="bold" aria-hidden />
              ) : (
                <CalendarBlank size={13} aria-hidden />
              )}
              <span className="tnum">{formatDueLabel(nextDue, todayDate)}</span>
            </span>
          )}

          <span className="tnum text-xs text-text-lo">
            {open} open
          </span>

          {course.meetings.length > 0 && (
            <span className="tnum truncate text-xs text-text-faint">
              {course.meetings.map(meetingLabel).join(', ')}
            </span>
          )}
        </span>
      </Link>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${course.code}`}
        className="grid size-7 shrink-0 place-items-center rounded-md text-text-faint hover:bg-raised hover:text-text-mid"
      >
        <PencilSimple size={13} aria-hidden />
      </button>

      {/* Courses within a term carry a sort key, so the order on this index is
          yours. Carets rather than a drag, the same call `ReorderStack` makes
          for a project row. */}
      <ReorderStack
        label={course.code}
        first={first}
        last={last}
        onUp={() => onMove(-1)}
        onDown={() => onMove(1)}
      />
    </div>
  );
}
