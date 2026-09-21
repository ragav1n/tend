'use client';

import { Chalkboard, GraduationCap } from '@phosphor-icons/react/dist/ssr';
import type { CourseEvent } from '@/lib/db/types';
import { formatClock } from '@/lib/format/date';
import { cn } from '@/lib/utils';

/**
 * What is happening on a day that is not work.
 *
 * A lecture, an exam slot, an office hour. These come from a subscribed feed and
 * are read-only: there is nothing to tick off, nothing to reschedule, and no
 * sensible undo. So they sit above the task list as context for it rather than
 * inside it, and they are quieter than a task deliberately. A class you cannot
 * act on should not compete with a deadline you can.
 *
 * Exams are the exception and read louder, because an exam is the one item here
 * that changes what you would do today.
 */
export function DayEvents({ events }: { events?: readonly CourseEvent[] }) {
  if (!events || events.length === 0) return null;

  return (
    <ul className="mb-4 space-y-1">
      {events.map((event) => {
        const exam = event.kind === 'exam';
        const Icon = exam ? GraduationCap : Chalkboard;

        return (
          <li
            key={event.id}
            className={cn(
              'flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs',
              exam ? 'border-clay-400/50 bg-clay-600/5' : 'border-line/60',
            )}
          >
            <Icon
              size={13}
              weight={exam ? 'bold' : 'regular'}
              aria-hidden
              className={exam ? 'text-clay-200' : 'text-text-faint'}
            />
            <span className={cn('min-w-0 flex-1 truncate', exam ? 'text-text-hi' : 'text-text-mid')}>
              {event.title}
            </span>
            {/* The end time comes down the feed and was being dropped, so a
                50 minute lecture and a 3 hour lab read the same. On a screen
                about where the hours go, the length is the useful half. */}
            {event.startsAt !== null && (
              <span className="tnum shrink-0 text-text-lo">
                {event.endsAt !== null && event.endsAt !== event.startsAt
                  ? `${formatClock(event.startsAt)} to ${formatClock(event.endsAt)}`
                  : formatClock(event.startsAt)}
              </span>
            )}
            {event.location !== '' && (
              <span className="hidden shrink-0 truncate text-text-faint sm:block">
                {event.location}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
