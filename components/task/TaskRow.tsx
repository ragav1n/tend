'use client';

import { motion, useReducedMotion } from 'motion/react';
import {
  Check,
  CalendarBlank,
  Flag,
  ListChecks,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import { PRESS_DEPTH, ROW, SNAPPY, rowVariants } from '@/lib/motion';
import { formatClock, formatDueLabel } from '@/lib/format/date';
import { today } from '@/lib/db/queries';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import { cn } from '@/lib/utils';
import { StruckTitle } from './StruckTitle';
import { TaskCheck } from './TaskCheck';

/**
 * One task in a list.
 *
 * The row carries the tactile-material rules: it sits on `surface` above the
 * `void` page, gets a 1px top highlight from `--shadow-raised`, and sinks 1px
 * under a press. Contrast follows the ramp: body text is `text-hi` on surface,
 * meta is `text-lo`, and the overdue marker steps up to `clay-200` because it
 * has to be readable rather than merely tinted.
 */

interface TaskRowProps {
  task: Task;
  onToggle: (id: string, done: boolean) => void;
  onOpen?: (id: string) => void;
  /** Today, passed in so a long list computes it once instead of per row. */
  todayDate?: string;
  /** The list is in selection mode, so the row offers a checkbox and its body
   *  picks rather than opens. */
  selectable?: boolean;
  selected?: boolean;
  /** `extend` is the shift key, which grows a run from the last plain pick. */
  onPick?: (id: string, extend: boolean) => void;
  /** "2/5", when the task has children. Passed in because the list already
   *  fetched every parent's children in one go. */
  subtaskCount?: string | null;
  /** The names of this task's tags, in the order it holds them. Resolved by the
   *  list from one `useTags`, because a name lookup per row is a live query per
   *  row. A count was all this row used to show, which made a tag something you
   *  could add and then never see again. */
  tagNames?: readonly string[];
  /** Rendered inside this row's list item, under the card. The subtasks go
   *  here: they belong to this row rather than beside it, and a second `li`
   *  wrapping both would be an `li` inside an `li`. */
  children?: React.ReactNode;
}

/** Names on the row before the rest become a count. */
const MAX_TAG_NAMES = 2;

const PRIORITY_LABEL: Record<number, string> = {
  1: 'Low priority',
  2: 'Medium priority',
  3: 'High priority',
};

export function TaskRow({
  task,
  onToggle,
  onOpen,
  todayDate = today(),
  selectable = false,
  selected = false,
  onPick,
  subtaskCount = null,
  tagNames = [],
  children,
}: TaskRowProps) {
  const reduced = useReducedMotion();
  const done = task._done === 1;
  const overdue = !done && task._dueDay !== NO_DUE_DAY && task._dueDay < todayDate;
  const hasDue = task._dueDay !== NO_DUE_DAY;

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
      <motion.div
        className={cn(
          'group flex items-start gap-3 rounded-lg border bg-surface px-3.5 py-3 text-left',
          // The keyboard cursor is focus on the body button, so it wears the
          // app's own focus ring. Drawn out here on the card: a ring around the
          // title alone reads as a link rather than as the row you are on. The
          // selector names that one button, or the check and the select box
          // would each draw a second ring inside this one.
          'has-[[data-row-id]:focus-visible]:outline has-[[data-row-id]:focus-visible]:outline-2',
          'has-[[data-row-id]:focus-visible]:outline-clay-400',
          'has-[[data-row-id]:focus-visible]:outline-offset-2',
          selected ? 'border-clay-400' : 'border-line',
        )}
        style={{ boxShadow: 'var(--shadow-flush)' }}
        whileTap={reduced ? undefined : { y: 1 }}
        transition={PRESS_DEPTH}
      >
        {selectable && (
          <motion.div
            className="flex min-h-[22px] items-center"
            initial={reduced ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={SNAPPY}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={`Select ${task.title}`}
              onClick={(event) => onPick?.(task.id, event.shiftKey)}
              className={cn(
                'grid size-[22px] place-items-center rounded-[6px] border',
                selected
                  ? 'border-clay-400 bg-clay-600 text-on-accent'
                  : 'border-line-strong text-transparent hover:border-clay-400',
              )}
            >
              <Check size={13} weight="bold" aria-hidden />
            </button>
          </motion.div>
        )}

        <div>
          {/* The one element shared with the detail panel. The check is the
              right choice for it because it is the same 22px box in both
              places: a title would have to warp between two font sizes, which
              is what makes most shared-element text transitions look wrong. */}
          <TaskCheck
            checked={done}
            onChange={(next) => onToggle(task.id, next)}
            label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
            layoutId={`task-check-${task.id}`}
          />
        </div>

        <button
          type="button"
          // The row the keyboard cursor lands on. `use-list-cursor.ts` collects
          // these in document order and focuses one, which is what makes Enter
          // here the browser's own click rather than a binding.
          data-row-id={task.id}
          // In selection mode the whole row picks. Leaving the body as "open"
          // would make the checkbox the only target, which is a 22px box.
          onClick={(event) =>
            selectable ? onPick?.(task.id, event.shiftKey) : onOpen?.(task.id)
          }
          className="min-w-0 flex-1 text-left focus-visible:outline-none"
        >
          {/* The title's first line occupies the same 22px the check does, and
              centres inside it. Without this the row is `items-start` and a
              15px line sits three pixels above a 22px box, which is small
              enough to look like a mistake and big enough to see. */}
          <span className="flex min-h-[22px] max-w-full items-center">
            <StruckTitle
              title={task.title}
              done={done}
              className={cn(
                'text-[0.9375rem] leading-snug transition-colors duration-200',
                done ? 'text-text-lo' : 'text-text-hi',
              )}
            />
          </span>

          {(hasDue || task.priority > 0 || tagNames.length > 0 || subtaskCount) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {hasDue && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-xs',
                    overdue ? 'text-clay-200' : 'text-text-lo',
                  )}
                >
                  {overdue ? (
                    <WarningCircle size={13} weight="bold" aria-hidden />
                  ) : (
                    <CalendarBlank size={13} aria-hidden />
                  )}
                  <span className="tnum">
                    {formatDueLabel(task._dueDay, todayDate)}
                    {task.dueTime ? ` ${formatClock(task.dueTime)}` : ''}
                  </span>
                </span>
              )}

              {task.priority > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-clay-300"
                  title={PRIORITY_LABEL[task.priority]}
                >
                  <Flag size={13} weight="fill" aria-hidden />
                  <span className="tnum">P{4 - task.priority}</span>
                </span>
              )}

              {/* Two names, then a count for the rest. A row with six tags on it
                  turns into a wall of hashes and the title stops being the thing
                  you read first. */}
              {tagNames.slice(0, MAX_TAG_NAMES).map((name) => (
                <span key={name} className="text-xs text-text-lo">
                  #{name}
                </span>
              ))}
              {tagNames.length > MAX_TAG_NAMES && (
                <span className="tnum text-xs text-text-lo">
                  +{tagNames.length - MAX_TAG_NAMES}
                </span>
              )}

              {subtaskCount && (
                <span className="inline-flex items-center gap-1 text-xs text-text-lo">
                  <ListChecks size={13} aria-hidden />
                  <span className="tnum">{subtaskCount}</span>
                </span>
              )}
            </div>
          )}
        </button>
      </motion.div>

      {children}
    </motion.li>
  );
}
