'use client';

import { motion, useReducedMotion } from 'motion/react';
import { CalendarBlank, Flag, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { PRESS_DEPTH, ROW, STRIKE, rowVariants } from '@/lib/motion';
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
}

const PRIORITY_LABEL: Record<number, string> = {
  1: 'Low priority',
  2: 'Medium priority',
  3: 'High priority',
};

/** Weekday and month for anything inside a week, then a date. */
function formatDue(due: string, todayDate: string): string {
  if (due === todayDate) return 'Today';

  const [y, m, d] = due.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d);
  const [ty, tm, td] = todayDate.split('-').map(Number) as [number, number, number];
  const diff = Math.round((asUtc - Date.UTC(ty, tm - 1, td)) / 86_400_000);

  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) {
    return new Date(asUtc).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
  }
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  return new Date(asUtc).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatTime(time: string): string {
  const [h, min] = time.split(':').map(Number) as [number, number];
  const meridiem = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return min === 0 ? `${hour}${meridiem}` : `${hour}:${String(min).padStart(2, '0')}${meridiem}`;
}

export function TaskRow({ task, onToggle, onOpen, todayDate = today() }: TaskRowProps) {
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
          'group flex items-start gap-3 rounded-lg border border-line bg-surface',
          'px-3.5 py-3 text-left',
        )}
        style={{ boxShadow: 'var(--shadow-flush)' }}
        whileTap={reduced ? undefined : { y: 1 }}
        transition={PRESS_DEPTH}
      >
        <div className="pt-0.5">
          <TaskCheck
            checked={done}
            onChange={(next) => onToggle(task.id, next)}
            label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          />
        </div>

        <button
          type="button"
          onClick={() => onOpen?.(task.id)}
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
                    {formatDue(task._dueDay, todayDate)}
                    {task.dueTime ? ` ${formatTime(task.dueTime)}` : ''}
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
