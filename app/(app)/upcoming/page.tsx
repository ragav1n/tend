'use client';

import { CalendarDots } from '@phosphor-icons/react/dist/ssr';
import { EmptyState } from '@/components/views/EmptyState';
import { LoadStrip } from '@/components/views/LoadStrip';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useFirstLoadComplete, useUpcomingList } from '@/hooks/use-tasks';
import { useWorkload } from '@/hooks/use-workload';

export default function UpcomingPage() {
  const tasks = useUpcomingList(30);
  const loaded = useFirstLoadComplete();
  // Two weeks of bars rather than thirty. Seven days is a row you can read at
  // 393px and thirty is a smear, and a fortnight is the horizon a deadline is
  // actually decided in.
  const workload = useWorkload(14);

  return (
    <>
      <ViewHeader title="Upcoming" eyebrow="NEXT 30 DAYS" />

      <LoadStrip
        days={workload.days}
        overdrawn={workload.overdrawn}
        unestimated={workload.unestimated}
      />

      <TaskList
        tasks={tasks}
        loading={!loaded}
        slack={workload.byDay}
        empty={<EmptyState icon={CalendarDots} title="Nothing dated in the next month" />}
      />
    </>
  );
}
