'use client';

import { useMemo, useState } from 'react';
import { Kanban } from '@phosphor-icons/react/dist/ssr';
import { Board } from '@/components/views/Board';
import { EmptyState } from '@/components/views/EmptyState';
import { Segmented } from '@/components/ui/Segmented';
import { ViewHeader } from '@/components/views/ViewHeader';
import { useLogbook, useOpenTasks, useProjects } from '@/hooks/use-tasks';
import { useUiStore } from '@/hooks/use-ui';
import { moveFor, projectBoard, statusBoard, type GroupBy } from '@/lib/board/columns';
import { completeTask, updateTask } from '@/lib/db/mutations';
import { today } from '@/lib/db/queries';

/**
 * The board.
 *
 * Two groupings, because they answer different questions: status says how far
 * along everything is, project says where the work is piling up. Both read the
 * same open set, so switching costs one render and no query.
 */

/** Enough to see what got finished lately, few enough that Done stays a column
 *  rather than becoming the logbook. */
const RECENT_DONE = 12;

export default function BoardPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const open = useOpenTasks();
  const done = useLogbook(RECENT_DONE);
  const projects = useProjects();
  const openTask = useUiStore((state) => state.openTask);
  const todayDate = today();

  const columns = useMemo(
    () =>
      groupBy === 'status'
        ? statusBoard(open, done, RECENT_DONE)
        : projectBoard(open, projects),
    [groupBy, open, done, projects],
  );

  function move(taskId: string, columnId: string) {
    const task = open.find((t) => t.id === taskId) ?? done.find((t) => t.id === taskId);
    if (!task) return;

    const intent = moveFor(groupBy, task, columnId);
    if (intent.kind === 'none') return;
    // Completing goes through completeTask because a recurring task materializes
    // its next occurrence there. Everything else is a field write.
    if (intent.kind === 'complete') void completeTask(taskId, true);
    else void updateTask(taskId, intent.patch);
  }

  const empty = columns.every((column) => column.tasks.length === 0);

  return (
    <>
      <ViewHeader title="Board" eyebrow="EVERYTHING OPEN" />

      <div className="mb-4 max-w-[19rem]">
        <Segmented
          id="board-group"
          label="Group by"
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: 'status', label: 'By status' },
            { value: 'project', label: 'By project' },
          ]}
        />
      </div>

      {empty ? (
        <EmptyState
          icon={Kanban}
          title="Nothing to arrange yet"
          hint="Tasks show up here as soon as there are any."
        />
      ) : (
        <Board columns={columns} todayDate={todayDate} onMove={move} onOpen={openTask} />
      )}
    </>
  );
}
