'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { COMPLETED_ROW_LINGER_MS, listVariants, QUICK_FADE } from '@/lib/motion';
import { updateTask } from '@/lib/db/mutations';
import { today } from '@/lib/db/queries';
import type { Task } from '@/lib/db/types';
import { TaskRow } from '@/components/task/TaskRow';

/**
 * A list of task rows with enter, exit and reorder animation.
 *
 * The one non-obvious behaviour: a completed task stays on screen for
 * COMPLETED_ROW_LINGER_MS before leaving. Without it, checking something off a
 * filtered list yanks the row away mid-tick and the animation the user is looking
 * at never finishes. The row is held in local state rather than by delaying the
 * write, so the database updates immediately and the delay is purely visual.
 *
 * Entries only ever leave the linger set from the timer callback, never from an
 * effect that watches `tasks`. Syncing it in an effect would mean calling
 * setState during an effect body, which cascades renders on every query update.
 */

interface TaskListProps {
  tasks: Task[];
  loading?: boolean;
  empty?: React.ReactNode;
}

export function TaskList({ tasks, loading = false, empty }: TaskListProps) {
  const todayDate = today();
  const [lingering, setLingering] = useState<Task[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    // Copied into a local so the cleanup closes over the same Map the effect saw,
    // rather than whatever the ref points at when the component unmounts.
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  function forget(id: string) {
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    timers.current.delete(id);
    setLingering((prev) => prev.filter((t) => t.id !== id));
  }

  function handleToggle(id: string, done: boolean) {
    const row = tasks.find((t) => t.id === id);

    if (done && row) {
      // Held with _done forced on, so it renders checked for the whole linger
      // even after the live query stops returning it.
      setLingering((prev) =>
        prev.some((t) => t.id === id) ? prev : [...prev, { ...row, _done: 1 }],
      );
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(id, setTimeout(() => forget(id), COMPLETED_ROW_LINGER_MS));
    } else {
      forget(id);
    }

    void updateTask(id, { status: done ? 'done' : 'active' });
  }

  // Lingering rows keep their place, so the list does not reflow under a finger
  // mid-animation. The live row wins if the query still returns it.
  const shown = [...tasks];
  for (const row of lingering) {
    if (!shown.some((t) => t.id === row.id)) shown.push(row);
  }

  if (loading) {
    return (
      <ul className="space-y-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="h-[58px] animate-pulse rounded-lg border border-line bg-surface"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </ul>
    );
  }

  if (shown.length === 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={QUICK_FADE}>
        {empty}
      </motion.div>
    );
  }

  return (
    <LayoutGroup>
      <motion.ul variants={listVariants} initial="hidden" animate="visible" className="space-y-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {shown.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={handleToggle} todayDate={todayDate} />
          ))}
        </AnimatePresence>
      </motion.ul>
    </LayoutGroup>
  );
}
