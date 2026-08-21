'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { COMPLETED_ROW_LINGER_MS, listVariants, QUICK_FADE } from '@/lib/motion';
import { withHeld, type Held } from '@/lib/views/held';
import { completeTask } from '@/lib/db/mutations';
import { today } from '@/lib/db/queries';
import type { Task } from '@/lib/db/types';
import { useSelectionStore } from '@/hooks/use-selection';
import { useSubtasksFor, useTagNames } from '@/hooks/use-tasks';
import { useUiStore } from '@/hooks/use-ui';
import { SubtaskRows, subtaskProgress } from '@/components/task/SubtaskRows';
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
 * A held row goes back at the index it was ticked at. Appended instead, the row
 * you just checked off travelled to the bottom of the list and faded there,
 * which reads as a move rather than a completion.
 *
 * Entries only ever leave the linger set from the timer callback, never from an
 * effect that watches `tasks`. Syncing it in an effect would mean calling
 * setState during an effect body, which cascades renders on every query update.
 *
 * The list knows the order its rows are in, and order is what a shift-click
 * spans, so it owns that much of selection and nothing else. It reports what it
 * shows to the store and the store owns the mode, because the mode belongs to
 * the page: the keyboard cursor and the action bar both live in the shell, and a
 * page can hold several lists.
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
  const reportRows = useSelectionStore((state) => state.report);
  const forgetRows = useSelectionStore((state) => state.forget);
  const pageRows = useSelectionStore((state) => state.total);
  // Identifies this list to the store. Generated rather than asked of the caller:
  // nine pages mount one, two mount several, and none of them has a name for it.
  const listId = useId();
  const [lingering, setLingering] = useState<Held<Task>[]>([]);
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
    setLingering((prev) => prev.filter((held) => held.task.id !== id));
  }

  function handleToggle(id: string, done: boolean) {
    // Measured against the rendered list rather than the query result, because
    // the rendered list is what the row is sitting in. Against `tasks`, a second
    // row ticked inside the same linger window lands one slot high for every
    // row already being held.
    const index = shown.findIndex((t) => t.id === id);
    const row = index === -1 ? undefined : shown[index];

    if (done && row) {
      // Held with _done forced on, so it renders checked for the whole linger
      // even after the live query stops returning it.
      setLingering((prev) =>
        prev.some((held) => held.task.id === id)
          ? prev
          : [...prev, { task: { ...row, _done: 1 }, index }],
      );
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(id, setTimeout(() => forget(id), COMPLETED_ROW_LINGER_MS));
    } else {
      // Held unchecked rather than forgotten. The live query has not caught up
      // yet, so dropping the entry leaves the row in neither list for a commit
      // and AnimatePresence plays the exit it was just rescued from: the row
      // slides out, the ones under it jump up, and it comes back. The timer
      // already running clears the entry once the query holds the row again.
      setLingering((prev) =>
        prev.map((held) =>
          held.task.id === id ? { ...held, task: { ...held.task, _done: 0 } } : held,
        ),
      );
    }

    // completeTask rather than a status patch: a recurring task materializes
    // its next occurrence here, and a patch would silently skip that.
    void completeTask(id, done);
  }

  // Held rows go back where they were, so the list does not reflow under a
  // finger mid-animation. The placement rule lives in `withHeld`, where a test
  // can hold it.
  const shown = withHeld(tasks, lingering);

  const order = shown.map((task) => task.id);
  // One query for the whole page. The key is the joined ids, so it re-runs when
  // the list changes rather than on every render.
  const subtasks = useSubtasksFor(order);
  // One lookup for the page. A row holds tag ids, and a tag it cannot name is a
  // tag nobody can see.
  const tagNames = useTagNames();
  // Joined so the dependency is a value. An array literal changes identity every
  // render and would re-run this on each one.
  const orderKey = order.join(',');
  useEffect(() => {
    reportRows(listId, orderKey === '' ? [] : orderKey.split(','));
  }, [listId, orderKey, reportRows]);

  // Leaving the page takes this list's rows out of the selection, and the last
  // list to leave ends the mode. The store decides which of those happened,
  // since a list cannot see its siblings.
  useEffect(() => () => forgetRows(listId), [listId, forgetRows]);

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
          is something to compare. Counted over the page rather than this list:
          the logbook can put a day holding one task next to a day holding five,
          and the mode spans both. This list's own count answers first so the
          button does not appear a frame late on every ordinary view. */}
      {(shown.length > 1 || pageRows > 1) && (
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
        // The keyboard cursor reads this to know which rows a selection spans,
        // since one page can hold several lists.
        data-task-list
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
                tagNames={task._tagIds
                  .map((id) => tagNames.get(id))
                  .filter((name): name is string => name !== undefined)}
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
    </LayoutGroup>
  );
}
