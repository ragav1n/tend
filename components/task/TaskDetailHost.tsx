'use client';

import { useEffect, useState } from 'react';
import { useUiStore } from '@/hooks/use-ui';
import { useTask } from '@/hooks/use-tasks';
import { Sheet } from '@/components/ui/Sheet';
import { TaskDetail } from './TaskDetail';

/**
 * Mounts the detail panel once for the whole app.
 *
 * One host rather than a sheet per list: the panel outlives the row that opened
 * it, since checking a task off inside the panel can drop that row from the
 * filtered list underneath.
 */
export function TaskDetailHost() {
  const openTaskId = useUiStore((state) => state.openTaskId);
  const closeTask = useUiStore((state) => state.closeTask);

  // The panel keeps rendering its task through the close animation, but
  // openTaskId is null the instant close is called. Latching the last id during
  // render is React's own answer to deriving state from a changing input: it
  // re-renders before committing, so the sheet never animates out empty and no
  // ref gets read during render.
  const [shownId, setShownId] = useState<string | null>(null);
  if (openTaskId !== null && openTaskId !== shownId) setShownId(openTaskId);

  const task = useTask(shownId);

  // A task deleted from somewhere else leaves the panel showing a tombstone, so
  // the panel steps aside. Deleting from inside the panel already closed it.
  useEffect(() => {
    if (openTaskId !== null && task?._del === 1) closeTask();
  }, [openTaskId, task, closeTask]);

  const open = openTaskId !== null && task !== undefined && task._del === 0;

  return (
    <Sheet open={open} onClose={closeTask} label="Task detail">
      {task && <TaskDetail key={task.id} task={task} onClose={closeTask} />}
    </Sheet>
  );
}
