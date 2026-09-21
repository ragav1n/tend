'use client';

import { Sun } from '@phosphor-icons/react/dist/ssr';
import { QuickAdd } from '@/components/task/QuickAdd';
import { DeferredSection } from '@/components/views/FoldedTasks';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useFirstLoadComplete, useTodayDeferred, useTodayList, useTodayProgress } from '@/hooks/use-tasks';
import { today, todayGroup } from '@/lib/db/queries';

export default function TodayPage() {
  const tasks = useTodayList();
  const deferred = useTodayDeferred();
  const progress = useTodayProgress();
  const loaded = useFirstLoadComplete();

  const day = today();
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
        <QuickAdd defaults={{ plannedFor: day }} placeholder="What needs doing today" />
      </div>

      <TaskList
        tasks={tasks}
        loading={!loaded}
        // Today arranges by hand on its own column, so ordering it here leaves
        // every project list alone. Grouped by the query's own predicate: a row
        // cannot cross from the overdue run into today's, because the sort would
        // put it straight back.
        reorder={{ field: 'plannedSortKey', group: (task) => todayGroup(task, day) }}
        empty={
          <EmptyState
            icon={Sun}
            title="Nothing scheduled for today"
            hint="Add something above, or leave it clear."
          />
        }
      />

      <DeferredSection tasks={deferred} />
    </>
  );
}
