'use client';

import { Sun } from '@phosphor-icons/react/dist/ssr';
import { QuickAdd } from '@/components/task/QuickAdd';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useFirstLoadComplete, useTodayList, useTodayProgress } from '@/hooks/use-tasks';
import { today } from '@/lib/db/queries';

export default function TodayPage() {
  const tasks = useTodayList();
  const progress = useTodayProgress();
  const loaded = useFirstLoadComplete();

  const date = new Date();
  const eyebrow = date
    .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();

  return (
    <>
      <ViewHeader title="Today" eyebrow={eyebrow} progress={progress} />

      <div className="mb-5">
        {/* A task typed here with no date is planned for today rather than left
            dateless, which is what someone means by adding it to Today. */}
        <QuickAdd defaults={{ plannedFor: today() }} placeholder="What needs doing today" />
      </div>

      <TaskList
        tasks={tasks}
        loading={!loaded}
        empty={
          <EmptyState
            icon={Sun}
            title="Nothing scheduled for today"
            hint="Add something above, or leave it clear."
          />
        }
      />
    </>
  );
}
