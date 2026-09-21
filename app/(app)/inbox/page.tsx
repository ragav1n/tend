'use client';

import { Tray } from '@phosphor-icons/react/dist/ssr';
import { QuickAdd } from '@/components/task/QuickAdd';
import { DeferredSection } from '@/components/views/FoldedTasks';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useFirstLoadComplete, useInboxDeferred, useInboxList } from '@/hooks/use-tasks';

export default function InboxPage() {
  const tasks = useInboxList();
  const deferred = useInboxDeferred();
  const loaded = useFirstLoadComplete();

  return (
    <>
      <ViewHeader
        title="Inbox"
        eyebrow="UNFILED"
        subtitle="Anything not yet given a project or a date."
      />

      <div className="mb-5">
        <QuickAdd placeholder="Capture a thought" />
      </div>

      <TaskList
        tasks={tasks}
        loading={!loaded}
        reorder={{ field: 'sortKey' }}
        empty={
          <EmptyState
            icon={Tray}
            title="Inbox is empty"
            hint="Capture things here and sort them later."
          />
        }
      />

      <DeferredSection tasks={deferred} />
    </>
  );
}
