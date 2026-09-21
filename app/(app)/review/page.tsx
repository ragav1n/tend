'use client';

import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, Confetti } from '@phosphor-icons/react/dist/ssr';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { WeekChart } from '@/components/views/WeekChart';
import { CourseWeek } from '@/components/courses/CourseWeek';
import { useCompletedBetween, useFocusBetween, useOpenTasks, useOverdue } from '@/hooks/use-tasks';
import { usePrefs } from '@/hooks/use-prefs';
import { useCourses, useGradedBetween } from '@/hooks/use-courses';
import { academicWeek } from '@/lib/stats/academic';
import { shiftDays } from '@/lib/calendar/grid';
import { today } from '@/lib/db/queries';
import { formatMinutes } from '@/lib/focus/timer';
import { startOfWeek, streakLength, summarize, weekBounds, weekDays } from '@/lib/stats/review';
import { cn } from '@/lib/utils';

/**
 * The week, and what is still owed.
 *
 * Two halves on purpose. The top is what happened, which is the part that is
 * pleasant to read and worth reading once a week. The bottom is every open task
 * whose date has passed, live, with working checkboxes, because a review that
 * only reports is a report rather than a review.
 */

/** Enough history behind the week being viewed for the streak to count back
 *  through it. Nobody has a 60 day streak by accident. */
const STREAK_DAYS = 60;

function rangeLabel(from: string, to: string): string {
  const format = (date: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  };
  return `${format(from)} to ${format(to)}`.toUpperCase();
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'olive' | 'clay' }) {
  return (
    <div
      className="rounded-lg border border-line bg-surface px-3.5 py-3"
      style={{ boxShadow: 'var(--shadow-flush)' }}
    >
      <p
        className={cn(
          'tnum text-[1.375rem] leading-none',
          tone === 'olive' && 'text-olive-300',
          tone === 'clay' && 'text-clay-300',
          !tone && 'text-text-hi',
        )}
      >
        {value}
      </p>
      <p className="label mt-1.5 !text-[0.5625rem]">{label}</p>
    </div>
  );
}

export default function ReviewPage() {
  const prefs = usePrefs();
  const todayDate = today();
  const [offset, setOffset] = useState(0);

  const start = useMemo(
    () => shiftDays(startOfWeek(todayDate, prefs.weekStart), offset * 7),
    [todayDate, prefs.weekStart, offset],
  );
  const days = useMemo(() => weekDays(start), [start]);
  const bounds = useMemo(() => weekBounds(start), [start]);
  // The streak reaches back past the week on screen, so it reads its own window.
  const streakBounds = useMemo(
    () => weekBounds(shiftDays(start, -STREAK_DAYS)),
    [start],
  );

  const completed = useCompletedBetween(bounds.from, bounds.to);
  const forStreak = useCompletedBetween(streakBounds.from, bounds.to);
  const sessions = useFocusBetween(bounds.from, bounds.to);
  const overdue = useOverdue();

  // The week read through the courses. `allOpen` is here so a session can find
  // its course through a task finished in an earlier week, which is the common
  // case for anything long-running.
  const courses = useCourses();
  const allOpen = useOpenTasks();
  const graded = useGradedBetween(start, shiftDays(start, 6));

  const summary = useMemo(() => summarize(days, completed, sessions), [days, completed, sessions]);
  const academic = useMemo(
    () => academicWeek(courses, completed, sessions, [...allOpen, ...completed], graded),
    [courses, completed, sessions, allOpen, graded],
  );
  const thisWeek = offset === 0;
  // A past week gets the streak as it stood at the end of it. Showing today's
  // number beside March's totals reports something that is true and answers a
  // question nobody asked.
  const streak = useMemo(
    () => streakLength(forStreak, thisWeek ? todayDate : shiftDays(start, 6)),
    [forStreak, thisWeek, todayDate, start],
  );

  return (
    <>
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="label mb-1.5">Review</p>
          <h1 className="font-display text-[2rem] leading-none" suppressHydrationWarning>
            {thisWeek ? 'This week' : rangeLabel(start, shiftDays(start, 6))}
          </h1>
          {thisWeek && (
            <p className="mt-2 text-sm text-text-lo" suppressHydrationWarning>
              {rangeLabel(start, shiftDays(start, 6))}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOffset(offset - 1)}
            aria-label="Previous week"
            className="rounded-md border border-line bg-surface p-1.5 text-text-mid hover:text-text-hi"
          >
            <CaretLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setOffset(Math.min(0, offset + 1))}
            disabled={thisWeek}
            aria-label="Next week"
            className={cn(
              'rounded-md border border-line bg-surface p-1.5',
              thisWeek ? 'text-text-faint' : 'text-text-mid hover:text-text-hi',
            )}
          >
            <CaretRight size={16} aria-hidden />
          </button>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="finished" value={String(summary.completed)} tone="olive" />
        <Stat label="focused" value={formatMinutes(summary.focusSeconds)} />
        <Stat label="day streak" value={String(streak)} />
        <Stat label="overdue now" value={String(overdue.length)} tone={overdue.length > 0 ? 'clay' : undefined} />
      </div>

      <section className="mb-7 rounded-lg border border-line bg-surface/40 px-3 py-4">
        <WeekChart days={summary.days} todayDate={todayDate} />
        {summary.best && (
          <p className="mt-4 text-center text-xs text-text-lo" suppressHydrationWarning>
            Best day was{' '}
            {new Date(`${summary.best.date}T12:00:00`).toLocaleDateString(undefined, {
              weekday: 'long',
            })}
            , with {summary.best.completed} finished.
          </p>
        )}
      </section>

      <CourseWeek rows={academic.courses} unattributedSeconds={academic.unattributedSeconds} />

      <section className="mt-7">
        <h2 className="label mb-3">Still owed</h2>
        <TaskList
          tasks={overdue}
          empty={
            <EmptyState
              icon={Confetti}
              title="Nothing overdue"
              hint="Everything with a date on it is still ahead of you."
            />
          }
        />
      </section>
    </>
  );
}
