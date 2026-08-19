'use client';

import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, CalendarBlank } from '@phosphor-icons/react/dist/ssr';
import { CalendarMonth } from '@/components/views/CalendarMonth';
import { EmptyState } from '@/components/views/EmptyState';
import { QuickAdd } from '@/components/task/QuickAdd';
import { TaskList } from '@/components/views/TaskList';
import { useDueBetween } from '@/hooks/use-tasks';
import { usePrefs } from '@/hooks/use-prefs';
import { useUiStore } from '@/hooks/use-ui';
import { gridRange, groupByDate, monthLabel, monthOf, shiftMonth } from '@/lib/calendar/grid';
import { updateTask } from '@/lib/db/mutations';
import { today } from '@/lib/db/queries';
import type { PlainDate, Task } from '@/lib/db/types';
import { cn } from '@/lib/utils';

/**
 * The month, plus the day you are looking at.
 *
 * The list under the grid is the working surface: a phone cell is too small to
 * hold a title, and even on a laptop a chip that reads "Draft the quarterly..."
 * is not something you can act on. So the grid answers "when", the list answers
 * "what", and both stay on screen.
 */

const NO_TASKS: Task[] = [];

function dayLabel(day: PlainDate, todayDate: PlainDate): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return day === todayDate ? `Today, ${label}` : label;
}

export default function CalendarPage() {
  const prefs = usePrefs();
  const openTask = useUiStore((state) => state.openTask);
  const todayDate = today();

  const [month, setMonth] = useState(() => monthOf(todayDate));
  const [selected, setSelected] = useState<PlainDate>(todayDate);

  const { from, to } = gridRange(month, prefs.weekStart);
  const tasks = useDueBetween(from, to);
  const byDay = useMemo(() => groupByDate(tasks, (task) => task._dueDay), [tasks]);
  const dayTasks = byDay.get(selected) ?? NO_TASKS;

  function select(day: PlainDate) {
    setSelected(day);
    // Clicking a borrowed cell from either neighbour pages the grid, so the day
    // just selected is never one of the faded ones.
    if (monthOf(day) !== month) setMonth(monthOf(day));
  }

  function jumpToToday() {
    setMonth(monthOf(todayDate));
    setSelected(todayDate);
  }

  function reschedule(taskId: string, day: PlainDate) {
    void updateTask(taskId, { dueDate: day });
    setSelected(day);
  }

  return (
    <>
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="label mb-1.5">Calendar</p>
          <h1 className="font-display text-[2rem] leading-none" suppressHydrationWarning>
            {monthLabel(month)}
          </h1>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={jumpToToday}
            className={cn(
              'rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-text-mid',
              'hover:text-text-hi',
            )}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="Previous month"
            className="rounded-md border border-line bg-surface p-1.5 text-text-mid hover:text-text-hi"
          >
            <CaretLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label="Next month"
            className="rounded-md border border-line bg-surface p-1.5 text-text-mid hover:text-text-hi"
          >
            <CaretRight size={16} aria-hidden />
          </button>
        </div>
      </header>

      <CalendarMonth
        month={month}
        weekStart={prefs.weekStart}
        tasksByDay={byDay}
        selected={selected}
        todayDate={todayDate}
        onSelect={select}
        onMove={reschedule}
        onOpen={openTask}
      />

      <section className="mt-7">
        <h2 className="mb-3 text-sm text-text-mid" suppressHydrationWarning>
          {dayLabel(selected, todayDate)}
        </h2>

        <div className="mb-4">
          <QuickAdd defaults={{ dueDate: selected }} placeholder="Add for this day" />
        </div>

        <TaskList
          tasks={dayTasks}
          empty={<EmptyState icon={CalendarBlank} title="Nothing due on this day" />}
        />
      </section>
    </>
  );
}
