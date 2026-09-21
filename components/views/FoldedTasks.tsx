'use client';

import { useState } from 'react';
import { HourglassHigh, Prohibit } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { Task } from '@/lib/db/types';
import { TaskList } from './TaskList';

/**
 * A count you can open, at the foot of a list.
 *
 * The projects page built this shape first for finished work, and there are now
 * two more of it: tasks waiting for a start date, and tasks given up on. Both
 * exist for the same reason, which is that a list quietly hiding rows is a list
 * you cannot trust. Deferring a task only works if you can check it is still
 * there, and cancelling one has to leave it findable or it may as well be a
 * delete.
 *
 * The rows inside are a plain `TaskList` with no `reorder`. Neither pile has an
 * order the user arranged: one is ordered by the date it wakes up on, the other
 * by when it was dropped.
 */
function Fold({
  icon: IconComponent,
  label,
  tasks,
}: {
  icon: Icon;
  label: string;
  tasks: Task[];
}) {
  const [open, setOpen] = useState(false);

  if (tasks.length === 0) return null;

  return (
    <section className="mt-6 border-t border-line pt-4">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        className="label flex items-center gap-1.5 px-1 hover:text-text-mid"
      >
        <IconComponent size={13} aria-hidden />
        {label}
        <span className="tnum">({tasks.length})</span>
      </button>

      {open && (
        <div className="mt-2">
          <TaskList tasks={tasks} />
        </div>
      )}
    </section>
  );
}

/** Tasks a list is holding back until their start date. */
export function DeferredSection({ tasks }: { tasks: Task[] }) {
  return <Fold icon={HourglassHigh} label="Starts later" tasks={tasks} />;
}

/** Work given up on, which is not the same as work finished. */
export function CancelledSection({ tasks }: { tasks: Task[] }) {
  return <Fold icon={Prohibit} label="Cancelled" tasks={tasks} />;
}
