'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { COMPLETED_ROW_LINGER_MS, listVariants, QUICK_FADE } from '@/lib/motion';
import { completeTask } from '@/lib/db/mutations';
import { today } from '@/lib/db/queries';
import type { Task } from '@/lib/db/types';
import { useListCursor } from '@/hooks/use-list-cursor';
import { useSelectionStore } from '@/hooks/use-selection';
import { useSubtasksFor } from '@/hooks/use-tasks';
import { useUiStore } from '@/hooks/use-ui';
import { SubtaskRows, subtaskProgress } from '@/components/task/SubtaskRows';
import { TaskRow } from '@/components/task/TaskRow';
import { SelectionBarHost } from '@/components/views/SelectionBar';

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
 *
 * The list also owns selection mode, because it is the thing that knows the
 * order rows are in, and order is what a shift-click spans. It owns the keyboard
 * cursor for the same reason: `j` and `k` move focus between the rows this
 * container holds, so the cursor skips a collapsed subtask without being told
 * which children are showing.
 *
 * Subtasks render under their parent here. Every list query already drops them
 * from the top level with a note saying they appear underneath it, so until this
 * existed a subtask could only be reached by opening the parent. They are
 * fetched for the whole page in one hook rather than per row, because a hook per
 * row is a live query per row.
 */

interface TaskListProps {
  tasks: Task[];
  loading?: boolean;
  empty?: React.ReactNode;
}

export function TaskList({ tasks, loading = false, empty }: TaskListProps) {
  const todayDate = today();
  const openTask = useUiStore((state) => state.openTask);
  const selecting = useSelectionStore((state) => state.active);
  const selectedIds = useSelectionStore((state) => state.ids);
  const beginSelect = useSelectionStore((state) => state.begin);
  const endSelect = useSelectionStore((state) => state.end);
  const pickRow = useSelectionStore((state) => state.pick);
  const pruneSelection = useSelectionStore((state) => state.prune);
  const [lingering, setLingering] = useState<Task[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const rows = useRef<HTMLUListElement>(null);

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

    // completeTask rather than a status patch: a recurring task materializes
    // its next occurrence here, and a patch would silently skip that.
    void completeTask(id, done);
  }

  // Lingering rows keep their place, so the list does not reflow under a finger
  // mid-animation. The live row wins if the query still returns it.
  const shown = [...tasks];
  for (const row of lingering) {
    if (!shown.some((t) => t.id === row.id)) shown.push(row);
  }

  const order = shown.map((task) => task.id);
  // One query for the whole page. The key is the joined ids, so it re-runs when
  // the list changes rather than on every render.
  const subtasks = useSubtasksFor(order);
  // Joined so the dependency is a value. An array literal changes identity every
  // render and would re-run this on each one.
  const orderKey = order.join(',');
  useEffect(() => {
    pruneSelection(orderKey === '' ? [] : orderKey.split(','));
  }, [orderKey, pruneSelection]);

  // Selection mode ends with the list. Carrying it to the next view would leave
  // an action bar over a set of rows it no longer refers to.
  useEffect(() => endSelect, [endSelect]);

  // x picks the row under the cursor. A subtask is not in `order`, and the
  // effect above prunes anything the order does not hold, so picking one would
  // clear itself a tick later. Subtasks have no checkbox for the same reason.
  function pickCursorRow(id: string) {
    if (order.includes(id)) pickRow(id, order, false);
  }
  useListCursor(rows, pickCursorRow);

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
      {/* One row is not a selection, so the affordance only appears once there
          is something to compare. */}
      {shown.length > 1 && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={selecting ? endSelect : beginSelect}
            className="label rounded-md px-2 py-1 !text-[0.625rem] hover:text-text-mid"
          >
            {selecting ? 'Cancel' : 'Select'}
          </button>
        </div>
      )}

      <motion.ul
        ref={rows}
        variants={listVariants}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {shown.map((task) => {
            const children = subtasks.get(task.id);
            return (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={handleToggle}
                onOpen={openTask}
                todayDate={todayDate}
                selectable={selecting}
                selected={selectedIds.has(task.id)}
                onPick={(id, extend) => pickRow(id, order, extend)}
                subtaskCount={subtaskProgress(children)}
              >
                {children && (
                  <SubtaskRows
                    subtasks={children}
                    onToggle={handleToggle}
                    onOpen={openTask}
                    inset={selecting}
                  />
                )}
              </TaskRow>
            );
          })}
        </AnimatePresence>
      </motion.ul>

      <SelectionBarHost order={order} />
    </LayoutGroup>
  );
}
