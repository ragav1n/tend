'use client';

import { GraduationCap } from '@phosphor-icons/react/dist/ssr';
import type { CourseEvent } from '@/lib/db/types';
import { examRadar, whenLabel } from '@/lib/courses/upnext';
import { formatClock } from '@/lib/format/date';
import { cn } from '@/lib/utils';

/**
 * Exams close enough to change what you do today.
 *
 * Three weeks, because past that an exam is a date rather than a plan and a
 * radar showing everything is a calendar. Silent when nothing is inside the
 * window, which is most of a semester.
 *
 * Only the ones a feed knew about. An exam nobody entered into Canvas is not
 * here, and pretending otherwise would make an empty radar read as "clear"
 * rather than as "nothing told me".
 */
export function ExamRadar({ events, today }: { events: readonly CourseEvent[]; today: string }) {
  const rows = examRadar(events, today);
  if (rows.length === 0) return null;

  return (
    <section className="mb-4" aria-label="Exams coming up">
      <ul className="space-y-1.5">
        {rows.map(({ event, days }) => {
          const close = days <= 7;
          return (
            <li
              key={event.id}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs',
                close ? 'border-clay-400/50 bg-clay-600/5' : 'border-line',
              )}
              style={{ boxShadow: 'var(--shadow-flush)' }}
            >
              <GraduationCap
                size={14}
                weight={close ? 'bold' : 'regular'}
                aria-hidden
                className={close ? 'text-clay-200' : 'text-text-faint'}
              />
              <span className={cn('min-w-0 flex-1 truncate', close ? 'text-text-hi' : 'text-text-mid')}>
                {event.title}
              </span>
              {event.startsAt !== null && (
                <span className="tnum shrink-0 text-text-lo">{formatClock(event.startsAt)}</span>
              )}
              <span className={cn('tnum shrink-0', close ? 'text-clay-200' : 'text-text-lo')}>
                {whenLabel(days)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
