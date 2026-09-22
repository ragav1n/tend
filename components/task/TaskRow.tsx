'use client';

import { motion, useReducedMotion, type PanInfo } from 'motion/react';
import {
  ArrowElbowDownRight,
  Check,
  CalendarBlank,
  Flag,
  Hourglass,
  ListChecks,
  Prohibit,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import { PRESS_DEPTH, ROW, SNAPPY, rowVariants } from '@/lib/motion';
import { formatClock, formatDueLabel } from '@/lib/format/date';
import { today } from '@/lib/db/queries';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import { CANCEL_REASON_LABEL } from './TaskDetail';
import { cn } from '@/lib/utils';
import { ReorderStack } from '@/components/ui/ReorderStack';
import { useLongPressDrag } from '@/hooks/use-long-press-drag';
import type { DaySlack } from '@/lib/workload/slack';
import { formatWorkMinutes } from '@/lib/workload/capacity';
import type { Move, RowMove } from '@/lib/views/reorder';
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
  /** What this row belongs to, when it is a subtask standing on its own. The
   *  calendar puts a subtask carrying its own deadline in the day list, and
   *  "Draft the intro" with nothing saying which thing it drafts is a puzzle.
   *  Null on every list that renders children under their parent, where the
   *  parent is the row above. */
  parentTitle?: string | null;
  /** The names of this task's tags, in the order it holds them. Resolved by the
   *  list from one `useTags`, because a name lookup per row is a live query per
   *  row. A count was all this row used to show, which made a tag something you
   *  could add and then never see again. */
  tagNames?: readonly string[];
  /** Where this row can go, when the list it is in is hand-arranged. Absent on
   *  a list whose order is the query's rather than the user's, which is most of
   *  them: the logbook is completion order and Upcoming is date order. */
  /** Whether this deadline is still reachable. Null when the page has not
   *  worked it out, which is most of them. */
  slack?: DaySlack | null;
  move?: RowMove | null;
  onMove?: (move: Move) => void;
  /** Where a drag that ended over another row should put this one. The list
   *  resolves the slot, because only it knows the order. */
  onDrop?: (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void;
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
  parentTitle = null,
  tagNames = [],
  slack = null,
  move = null,
  onMove,
  onDrop,
  children,
}: TaskRowProps) {
  const reduced = useReducedMotion();
  // A row only lifts on a list that has an order to change, and only while the
  // carets are live, so a sorted list stays still.
  const draggable = move !== null && onDrop !== undefined && !selectable;
  const { controls, armed, release, handlers } = useLongPressDrag(draggable);
  const done = task._done === 1;
  const cancelled = task.status === 'cancelled';
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
      // The slot a drop lands on. Read off the stack under the pointer by the
      // same hit test the calendar and the board use, since the element under a
      // dragging finger is the dragged row itself.
      data-row-slot={task.id}
      drag={draggable ? 'y' : false}
      // Motion starts nothing on its own; the long press decides. Snapping back
      // on release hands the row to `layout`, which animates it to the slot the
      // reorder just gave it rather than leaving it at a dragged offset until
      // the query catches up.
      dragListener={false}
      dragControls={controls}
      dragSnapToOrigin
      dragMomentum={false}
      dragElastic={0.12}
      onDragEnd={(event, info) => {
        release();
        onDrop?.(event, info);
      }}
      className={cn('list-none', armed && 'relative z-10 select-none')}
      // At rest `touch-action` stays `auto`, or the list would not scroll. It is
      // locked only once a row is up, which is safe because the press only wins
      // after 350ms of a finger that has not moved: the browser has started no
      // scroll to fight over. Motion blocks `touchmove` itself once it owns the
      // pointer, so this is belt and braces for engines that re-read the
      // property mid-gesture.
      style={armed ? { touchAction: 'none', WebkitTouchCallout: 'none' } : undefined}
      {...handlers}
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
        style={{ boxShadow: armed ? 'var(--shadow-raised)' : 'var(--shadow-flush)' }}
        whileTap={reduced || armed ? undefined : { y: 1 }}
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
          // here the browser's own click rather than a binding. `data-row-top`
          // marks it as one x and s can act on, which a subtask is not.
          data-row-id={task.id}
          data-row-top
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

          {(hasDue ||
            cancelled ||
            (slack !== null && slack.slack < 0 && !done) ||
            task.priority > 0 ||
            tagNames.length > 0 ||
            parentTitle ||
            subtaskCount) && (
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

              {/* First after the date, because it is what the title is missing.
                  The same elbow the calendar chip wears, so the two surfaces
                  make the claim with one glyph. */}
              {parentTitle && (
                <span
                  className="inline-flex min-w-0 items-center gap-1 text-xs text-text-lo"
                  title={`Part of ${parentTitle}`}
                >
                  <ArrowElbowDownRight size={13} aria-hidden className="shrink-0" />
                  <span className="max-w-[12rem] truncate">{parentTitle}</span>
                </span>
              )}

              {/* Why it was dropped. Without it the cancelled pile is a list of
                  struck-through titles and no account of any of them. */}
              {cancelled && (
                <span className="inline-flex items-center gap-1 text-xs text-text-lo">
                  <Prohibit size={13} aria-hidden />
                  {CANCEL_REASON_LABEL[task.cancelReason ?? 'other']}
                </span>
              )}

              {/* The one thing a due date cannot say. Only shown when it has
                  actually gone negative: a badge on everything is furniture,
                  and "3h short" is a number you can act on. */}
              {slack !== null && slack.slack < 0 && !done && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-clay-200"
                  title="Even at full capacity, the work due by this date does not fit"
                >
                  <Hourglass size={13} weight="bold" aria-hidden />
                  <span className="tnum">{formatWorkMinutes(-slack.slack)} short</span>
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

        {/* Buttons rather than a drag, for the reason `ReorderStack` gives: a
            drag is a pointer shortcut and never the only path. Always on rather
            than behind `group-hover`, because a control revealed by hover does
            not exist on a phone at all. Hidden while selecting, where the whole
            row is a target and a caret inside it would pick instead of move. */}
        {move && onMove && !selectable && (
          <ReorderStack
            label={task.title}
            first={move.first}
            last={move.last}
            onUp={() => move.up && onMove(move.up)}
            onDown={() => move.down && onMove(move.down)}
            className="mt-px"
          />
        )}
      </motion.div>

      {children}
    </motion.li>
  );
}
