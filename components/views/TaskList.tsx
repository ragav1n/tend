'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { COMPLETED_ROW_LINGER_MS, listVariants, QUICK_FADE } from '@/lib/motion';
import { withHeld, type Held } from '@/lib/views/held';
import { completeTask, reorderTask } from '@/lib/db/mutations';
import { movesFor, moveToIndex, type Move, type RankField } from '@/lib/views/reorder';
import { slackFor } from '@/lib/workload/slack';
import type { DaySlack } from '@/lib/workload/slack';
import { clientPoint, targetFromStack } from '@/lib/dnd/drop';
import { sortByPressure, sortTasks, type ViewSort } from '@/lib/views/filter';
import { SORT_LABEL } from '@/lib/views/list-sort';
import { useListSort } from '@/hooks/use-list-sort';
import { today } from '@/lib/db/queries';
import type { Task } from '@/lib/db/types';
import { useSelectionStore } from '@/hooks/use-selection';
import { useSubtasksFor } from '@/hooks/use-tasks';
import { useUiStore } from '@/hooks/use-ui';
import { SubtaskRows, subtaskProgress } from '@/components/task/SubtaskRows';
import { cn } from '@/lib/utils';
import { useTagNames } from '@/components/task/TagNames';
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
 * On touch the carets are not a target worth aiming at, so a row can also be
 * picked up with a long press and dropped on another row's slot. The list
 * resolves that drop, because the row knows where the pointer landed and only
 * the list knows the order it landed in.
 *
 * A list that can be hand-arranged can also be sorted another way, so `reorder`
 * brings a sort picker with it. Picking anything but "My order" takes the carets
 * away for as long as it is picked: a caret writes a rank, and a list ordered by
 * due date would not read it back, so the row would appear not to move.
 *
 * Hand-arranged lists pass `reorder`, and the rows grow a pair of carets. Only
 * the lists whose order is the user's own take it: the logbook is completion
 * order and Upcoming is date order, so a caret there would write a rank nothing
 * reads. `movesFor` decides what each row can do, including the case Today
 * needs, where overdue work sits above the rest and a row cannot cross between
 * the two runs.
 *
 * Subtasks render under their parent here. Every list query already drops them
 * from the top level with a note saying they appear underneath it, so until this
 * existed a subtask could only be reached by opening the parent. They are
 * fetched for the whole page in one hook rather than per row, because a hook per
 * row is a live query per row.
 */

/** How a list's hand-arranged order works, on the lists that have one. */
export interface ReorderMode {
  /** The column the order lives in. Today is the only `plannedSortKey` list. */
  field: RankField;
  /** Rows sharing a key reorder among themselves. The caller passes rows already
   *  grouped, since the group is what the query sorted by. */
  group?: (task: Task) => string;
}

interface TaskListProps {
  tasks: Task[];
  loading?: boolean;
  empty?: React.ReactNode;
  reorder?: ReorderMode;
  /** Slack per due day, when the page has worked it out. A row uses it to say
   *  its deadline has already gone, which a due date alone cannot. */
  slack?: Map<string, DaySlack>;
  /** Title by parent id, for a list that can hold a subtask at top level. The
   *  calendar is the only one: a subtask with a deadline its parent does not
   *  share belongs to the day it is due, and the parent is not the row above
   *  it there. */
  parentTitles?: Map<string, string>;
}

export function TaskList({
  tasks,
  loading = false,
  empty,
  reorder,
  slack,
  parentTitles,
}: TaskListProps) {
  const todayDate = today();
  // Keyed by route rather than by list, so the two lists on the projects page do
  // not need names. Only the reorderable one shows the picker.
  const route = usePathname();
  const { sort, setSort } = useListSort(route);
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
  // Pressure needs the slack map, so it falls back to the page's own order when
  // the page did not work one out. Better an unchanged list than a sort that
  // silently means something else.
  const ordered =
    reorder && sort === 'pressure' && slack
      ? sortByPressure(tasks, slack)
      : reorder && sort !== 'manual'
        ? sortTasks(tasks, sort)
        : tasks;
  const shown = withHeld(ordered, lingering);

  // Read off the rendered list rather than the query result, so a row lingering
  // through its completion animation holds its slot and the rows around it keep
  // the ranks they are showing.
  const arranged = reorder && sort === 'manual';
  const moves = arranged ? movesFor(shown, reorder.field, reorder.group) : null;

  function handleMove(move: Move) {
    if (!reorder || !arranged) return;
    void reorderTask(move.id, move.prev, move.next, reorder.field);
  }

  /**
   * Where a dragged row was let go.
   *
   * Hit-tested against the pointer rather than tracked with hover, for the
   * reason `lib/dnd/drop.ts` gives: the element under a dragging finger is the
   * dragged row, and pointer capture means no target ever sees an enter event.
   * A drop that resolves to nothing, or back onto the row's own slot, is a drag
   * that moved nowhere, which `moveToIndex` answers with null.
   */
  function handleDrop(
    from: number,
    event: MouseEvent | TouchEvent | PointerEvent,
    info: Parameters<typeof clientPoint>[1],
  ) {
    if (!reorder || !arranged) return;

    const point = clientPoint(event, info);
    const source = document.querySelector(`[data-row-slot="${shown[from]?.id ?? ''}"]`);
    const slot = targetFromStack(
      document.elementsFromPoint(point.x, point.y),
      source,
      'data-row-slot',
    );
    if (slot === null) return;

    const to = shown.findIndex((task) => task.id === slot);
    const move = moveToIndex(shown, from, to, reorder.field, reorder.group);
    if (move) void reorderTask(move.id, move.prev, move.next, reorder.field);
  }

  const order = shown.map((task) => task.id);
  // One query for the whole page. The key is the joined ids, so it re-runs when
  // the list changes rather than on every render.
  const subtasks = useSubtasksFor(order);
  // One lookup for the page, from the shell. A row holds tag ids, and a tag it
  // cannot name is a tag nobody can see.
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
        <div className="mb-2 flex items-center justify-end gap-1">
          {reorder && !selecting && shown.length > 1 && (
            <SortPicker sort={sort} onChange={setSort} />
          )}
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
          {shown.map((task, index) => {
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
                parentTitle={parentTitles?.get(task.parentTaskId) ?? null}
                slack={slack ? slackFor(task, slack) : null}
                move={moves?.[index] ?? null}
                onMove={arranged ? handleMove : undefined}
                onDrop={
                  arranged ? (event, info) => handleDrop(index, event, info) : undefined
                }
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
                    parentDueDay={task._dueDay}
                    todayDate={todayDate}
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

/**
 * The list's order, as a native select.
 *
 * Native rather than a custom menu: five options is past what a segmented
 * control can hold, and a phone gets its own wheel for free. Styled down to the
 * size of the Select button beside it so the pair reads as one row of controls
 * rather than a form.
 */
function SortPicker({
  sort,
  onChange,
}: {
  sort: ViewSort;
  onChange: (sort: ViewSort) => void;
}) {
  return (
    <label className="label flex items-center gap-1 !text-[0.625rem]">
      <span className="sr-only">Order</span>
      <select
        value={sort}
        onChange={(event) => onChange(event.target.value as ViewSort)}
        aria-label="Order this list by"
        className={cn(
          'label cursor-pointer appearance-none rounded-md bg-transparent py-1 pl-2 pr-1',
          '!text-[0.625rem] hover:text-text-mid focus-visible:outline focus-visible:outline-2',
          'focus-visible:outline-clay-400',
        )}
      >
        {(Object.keys(SORT_LABEL) as ViewSort[]).map((value) => (
          <option key={value} value={value}>
            {SORT_LABEL[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
