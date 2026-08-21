'use client';

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CaretDown } from '@phosphor-icons/react/dist/ssr';
import { QUICK_FADE, ROW, rowVariants } from '@/lib/motion';
import type { Task } from '@/lib/db/types';
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
}

function SubtaskRow({
  task,
  onToggle,
  onOpen,
}: {
  task: Task;
  onToggle: (id: string, done: boolean) => void;
  onOpen?: (id: string) => void;
}) {
  const done = task._done === 1;

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
      </div>
    </motion.li>
  );
}

export function SubtaskRows({ subtasks, onToggle, onOpen, inset = false }: SubtaskRowsProps) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  if (subtasks.length === 0) return null;

  const done = subtasks.filter((task) => task._done === 1).length;
  const overflowing = subtasks.length > COLLAPSE_AFTER;
  // Open work first when collapsed, so the three on show are the three that
  // still need doing rather than whichever happen to sort first.
  const ordered = overflowing && !expanded
    ? [...subtasks].sort((a, b) => a._done - b._done)
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
            <SubtaskRow key={task.id} task={task} onToggle={onToggle} onOpen={onOpen} />
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
