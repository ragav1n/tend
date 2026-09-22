'use client';

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CaretDown } from '@phosphor-icons/react/dist/ssr';
import { QUICK_FADE, ROW, rowVariants } from '@/lib/motion';
import { formatDueLabel } from '@/lib/format/date';
import { today } from '@/lib/db/queries';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import { cn } from '@/lib/utils';
import { StruckTitle } from './StruckTitle';
import { TaskCheck } from './TaskCheck';

/**
 * A parent's children, under it, in the list.
 *
 * Every list query already drops subtasks with the note that they render
 * underneath their parent. This is the part that was missing, and until it
 * existed a subtask could only be seen or ticked by opening the parent.
 *
 * They are deliberately not `TaskRow`s. A subtask needs one line, a check and
 * nothing else: giving it the full row's due chip, priority flag and tag count
 * turns a three-item checklist into a wall the parent gets lost in. Tapping the
 * title still opens the detail panel, so nothing is unreachable.
 *
 * The one exception is a deadline the parent does not share. A part due Friday
 * inside a task due the following Thursday was showing Thursday on the row and
 * nothing at all underneath it, so the earlier date existed only in the detail
 * panel of the child. A date equal to the parent's stays off: repeating it on
 * every child is the wall this component exists to avoid.
 */

/**
 * How many show before the rest collapse.
 *
 * Three is what fits under a parent without the list reading as flat. Past that
 * the count carries the information ("2/9 done") and the rest are one tap away,
 * which is the answer to a task with twenty children: the parent stays scannable
 * and nothing is hidden without saying so.
 */
const COLLAPSE_AFTER = 3;

interface SubtaskRowsProps {
  subtasks: Task[];
  onToggle: (id: string, done: boolean) => void;
  onOpen?: (id: string) => void;
  /** Selection mode is on, so the parent row's checkbox column is wider and
   *  these indent to match. */
  inset?: boolean;
  /** The parent's due day, so a child only shows a date when it has one of its
   *  own. Absent means show every child's date, since there is nothing to
   *  compare it against. */
  parentDueDay?: string;
  /** Today, passed in so a page of lists computes it once. */
  todayDate?: string;
}

function SubtaskRow({
  task,
  onToggle,
  onOpen,
  ownDue,
  todayDate,
}: {
  task: Task;
  onToggle: (id: string, done: boolean) => void;
  onOpen?: (id: string) => void;
  /** This child's own deadline, when it is not its parent's. */
  ownDue: string | null;
  todayDate: string;
}) {
  const done = task._done === 1;
  const overdue = !done && ownDue !== null && ownDue < todayDate;

  return (
    <motion.li
      layout="position"
      variants={rowVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={ROW}
      className="list-none"
    >
      <div className="flex items-center gap-2.5 py-1">
        {/* 18px rather than the row's 22px, which is what reads as a child of
            the thing above it without needing a second indent. */}
        <TaskCheck
          checked={done}
          size={18}
          onChange={(next) => onToggle(task.id, next)}
          label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        />
        <button
          type="button"
          // Reachable from the keyboard cursor, same attribute the rows use. A
          // child on screen is a row you can walk onto; a collapsed one is not
          // rendered, so it is skipped without a rule saying so.
          data-row-id={task.id}
          onClick={() => onOpen?.(task.id)}
          className="min-w-0 flex-1 text-left"
        >
          <StruckTitle
            title={task.title}
            done={done}
            className={cn(
              'text-sm leading-snug transition-colors duration-200',
              done ? 'text-text-lo' : 'text-text-mid',
            )}
          />
        </button>

        {ownDue !== null && (
          <span
            className={cn(
              'tnum shrink-0 text-[0.6875rem]',
              done ? 'text-text-faint' : overdue ? 'text-clay-200' : 'text-text-lo',
            )}
          >
            {formatDueLabel(ownDue, todayDate)}
          </span>
        )}
      </div>
    </motion.li>
  );
}

export function SubtaskRows({
  subtasks,
  onToggle,
  onOpen,
  inset = false,
  parentDueDay,
  todayDate = today(),
}: SubtaskRowsProps) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  if (subtasks.length === 0) return null;

  const done = subtasks.filter((task) => task._done === 1).length;
  const overflowing = subtasks.length > COLLAPSE_AFTER;
  // Open work first when collapsed, and inside that the nearest deadline first,
  // so the three on show are the three that still need doing soonest rather than
  // whichever happen to sort first. The no-date sentinel sorts last, which puts
  // a child nobody has dated behind every child somebody has.
  const ordered = overflowing && !expanded
    ? [...subtasks].sort((a, b) => a._done - b._done || a._dueDay.localeCompare(b._dueDay))
    : subtasks;
  const shown = overflowing && !expanded ? ordered.slice(0, COLLAPSE_AFTER) : ordered;
  const hidden = subtasks.length - shown.length;

  return (
    <div
      className={cn(
        // Lines up with the parent's title, and the rule ties the group to it.
        'ml-3.5 border-l border-line pl-3.5',
        inset && 'ml-[2.125rem]',
      )}
    >
      <ul>
        <AnimatePresence initial={false}>
          {shown.map((task) => (
            <SubtaskRow
              key={task.id}
              task={task}
              onToggle={onToggle}
              onOpen={onOpen}
              ownDue={
                task._dueDay !== NO_DUE_DAY && task._dueDay !== parentDueDay
                  ? task._dueDay
                  : null
              }
              todayDate={todayDate}
            />
          ))}
        </AnimatePresence>
      </ul>

      {overflowing && (
        <motion.button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          initial={false}
          transition={reduced ? undefined : QUICK_FADE}
          className={cn(
            'label mt-0.5 flex items-center gap-1 rounded px-0.5 py-1',
            '!text-[0.625rem] hover:text-text-mid',
          )}
        >
          <motion.span
            aria-hidden
            animate={{ rotate: expanded ? 0 : -90 }}
            transition={reduced ? { duration: 0 } : QUICK_FADE}
            className="inline-flex"
          >
            <CaretDown size={11} weight="bold" />
          </motion.span>
          {expanded ? 'Show fewer' : `${hidden} more`}
          <span className="tnum ml-1 text-text-lo">
            {done}/{subtasks.length}
          </span>
        </motion.button>
      )}
    </div>
  );
}

/** The count a parent row shows, or null when it has no children. */
export function subtaskProgress(subtasks: Task[] | undefined): string | null {
  if (!subtasks || subtasks.length === 0) return null;
  return `${subtasks.filter((task) => task._done === 1).length}/${subtasks.length}`;
}
