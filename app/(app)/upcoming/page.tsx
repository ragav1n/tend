'use client';

import { CalendarDots } from '@phosphor-icons/react/dist/ssr';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useFirstLoadComplete, useUpcomingList } from '@/hooks/use-tasks';

export default function UpcomingPage() {
  const tasks = useUpcomingList(30);
  const loaded = useFirstLoadComplete();

  return (
    <>
      <ViewHeader title="Upcoming" eyebrow="NEXT 30 DAYS" />
      <TaskList
        tasks={tasks}
        loading={!loaded}
        empty={<EmptyState icon={CalendarDots} title="Nothing dated in the next month" />}
      />
    </>
  );
}
