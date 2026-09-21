'use client';

import { useMemo } from 'react';
import { CheckCircle } from '@phosphor-icons/react/dist/ssr';
import { CancelledSection } from '@/components/views/FoldedTasks';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useCancelledList, useFirstLoadComplete, useLogbook } from '@/hooks/use-tasks';
import { addDays, today } from '@/lib/db/queries';
import type { Task } from '@/lib/db/types';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * Finished work, newest first.
 *
 * Completing a task removes it from every open list, which is the point, but
 * without somewhere for it to land the app looks like it ate your work. This is
 * where it went.
 *
 * Grouped by the day it was finished rather than shown as one long list,
 * because "what did I get done yesterday" is the actual question people bring
 * here and an undifferentiated list cannot answer it.
 */

interface Day {
  key: string;
  label: string;
  tasks: Task[];
}

function labelFor(day: string, todayDate: string): string {
  if (day === todayDate) return 'Today';
  if (day === addDays(todayDate, -1)) return 'Yesterday';

  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Groups by local completion day. completedAt is an instant, so it is sliced
 *  after converting, not before: the UTC prefix is the wrong day after 7pm. */
function groupByDay(tasks: Task[], todayDate: string): Day[] {
  const days = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!task.completedAt) continue;
    const at = new Date(task.completedAt);
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
      at.getDate(),
    ).padStart(2, '0')}`;
    const bucket = days.get(key);
    if (bucket) bucket.push(task);
    else days.set(key, [task]);
  }

  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, group]) => ({ key, label: labelFor(key, todayDate), tasks: group }));
}

export default function LogbookPage() {
  // Remounts the dates below once hydration ends. `suppressHydrationWarning`
  // leaves the server's text in the DOM and records the client's in the
  // fiber, so a re-render finds no diff and the wrong date stays. A changed
  // key is what actually writes it. See the hook.
  const hydrated = useHydrated();
  const tasks = useLogbook(200);
  const loaded = useFirstLoadComplete();
  const todayDate = today();

  const cancelled = useCancelledList();
  const days = useMemo(() => groupByDay(tasks, todayDate), [tasks, todayDate]);

  return (
    <>
      <ViewHeader
        title="Logbook"
        eyebrow="DONE"
        subtitle="Everything you have finished. Uncheck anything to bring it back."
      />

      {days.length === 0 ? (
        <TaskList
          tasks={[]}
          loading={!loaded}
          empty={
            <EmptyState
              icon={CheckCircle}
              title="Nothing finished yet"
              hint="Completed tasks collect here."
            />
          }
        />
      ) : (
        <div className="space-y-6">
          {days.map((day) => (
            <section key={day.key}>
              <h2 className="label mb-2" key={hydrated ? 'client' : 'server'} suppressHydrationWarning>
                {day.label}
              </h2>
              {/* Keyed on the day so a row moving between groups remounts
                  rather than animating across a heading. */}
              <TaskList key={day.key} tasks={day.tasks} />
            </section>
          ))}
        </div>
      )}

      {/* Its own fold rather than mixed into the days above. Cancelled work is
          closed, which is why it belongs on this page, but it is not finished,
          which is why it does not belong in the count or the streak. */}
      <CancelledSection tasks={cancelled} />
    </>
  );
}
