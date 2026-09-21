'use client';

import { Archive } from '@phosphor-icons/react/dist/ssr';
import { DeferredSection } from '@/components/views/FoldedTasks';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useFirstLoadComplete, useSomedayDeferred, useSomedayList } from '@/hooks/use-tasks';

export default function SomedayPage() {
  const tasks = useSomedayList();
  const deferred = useSomedayDeferred();
  const loaded = useFirstLoadComplete();

  return (
    <>
      <ViewHeader
        title="Someday"
        eyebrow="NO DATE"
        subtitle="Things worth doing with no commitment yet."
      />
      <TaskList
        tasks={tasks}
        loading={!loaded}
        reorder={{ field: 'sortKey' }}
        empty={<EmptyState icon={Archive} title="Nothing parked here" />}
      />

      <DeferredSection tasks={deferred} />
    </>
  );
}
