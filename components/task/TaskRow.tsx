'use client';

import { motion, useReducedMotion } from 'motion/react';
import { Check, CalendarBlank, Flag, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { PRESS_DEPTH, ROW, SNAPPY, STRIKE, rowVariants } from '@/lib/motion';
import { formatClock, formatDueLabel } from '@/lib/format/date';
import { today } from '@/lib/db/queries';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import { cn } from '@/lib/utils';
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
}

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
          selected ? 'border-clay-400' : 'border-line',
        )}
        style={{ boxShadow: 'var(--shadow-flush)' }}
        whileTap={reduced ? undefined : { y: 1 }}
        transition={PRESS_DEPTH}
      >
        {selectable && (
          <motion.div
            className="pt-0.5"
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

        <div className="pt-0.5">
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
          // In selection mode the whole row picks. Leaving the body as "open"
          // would make the checkbox the only target, which is a 22px box.
          onClick={(event) =>
            selectable ? onPick?.(task.id, event.shiftKey) : onOpen?.(task.id)
          }
          className="min-w-0 flex-1 text-left"
        >
          <span className="relative inline-block max-w-full align-top">
            <span
              className={cn(
                'block truncate text-[0.9375rem] leading-snug transition-colors duration-200',
                done ? 'text-text-lo' : 'text-text-hi',
              )}
            >
              {task.title}
            </span>
            {/* Sweeps from the left rather than fading in, so it reads as a pen
                stroke through the words. scaleX only, so it stays on the
                compositor. */}
            <motion.span
              aria-hidden
              className="absolute left-0 top-1/2 h-[1.5px] w-full origin-left rounded-full bg-olive-300"
              initial={false}
              animate={{ scaleX: done ? 1 : 0, opacity: done ? 1 : 0 }}
              transition={done ? STRIKE : { duration: 0.12 }}
            />
          </span>

          {(hasDue || task.priority > 0 || task._tagIds.length > 0) && (
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

              {task._tagIds.length > 0 && (
                <span className="label !text-[0.625rem] !tracking-[0.14em]">
                  {task._tagIds.length} {task._tagIds.length === 1 ? 'tag' : 'tags'}
                </span>
              )}
            </div>
          )}
        </button>
      </motion.div>
    </motion.li>
  );
}
