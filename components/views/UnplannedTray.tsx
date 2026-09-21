'use client';

import { useRef, useState } from 'react';
import { motion, useReducedMotion, type PanInfo } from 'motion/react';
import { CaretDown, Tray } from '@phosphor-icons/react/dist/ssr';
import { targetUnderPointer } from '@/lib/dnd/drop';
import type { PlainDate, Task } from '@/lib/db/types';
import { formatWorkMinutes } from '@/lib/workload/capacity';
import { cn } from '@/lib/utils';

/**
 * Dateless work, draggable onto a day.
 *
 * This is what makes the calendar a planning surface rather than a report. The
 * grid already answers "what is my week", and the load pips answer "where is
 * there room"; what was missing was any way to act on the two together without
 * opening each task and typing a date.
 *
 * It drops onto the same `data-day` cells the existing chips do, through the
 * same hit test, so there is one idea of what a drop target is. Hit-tested
 * against the pointer rather than tracked with hover, because the element under
 * a dragging finger is the dragged chip and pointer capture means no cell ever
 * sees an enter event.
 *
 * Folded by default and silent when empty. Somebody with nothing parked does not
 * need a tray, and a permanent empty shelf above the grid is furniture.
 *
 * A tap still opens the task. `dragged` is the flag that tells a tap from a
 * drag, which motion does not do on its own.
 */

/** Shown before the rest becomes a count. A tray is a shelf, not a list. */
const MAX_CHIPS = 12;

export function UnplannedTray({
  tasks,
  onSchedule,
  onOpen,
}: {
  tasks: readonly Task[];
  onSchedule: (taskId: string, day: PlainDate) => void;
  onOpen: (taskId: string) => void;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const chips = useRef(new Map<string, HTMLElement>());
  const dragged = useRef(false);

  if (tasks.length === 0) return null;

  const shown = tasks.slice(0, MAX_CHIPS);
  const planned = tasks.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0);

  function handleDragEnd(
    taskId: string,
    event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) {
    setDragging(null);
    const day = targetUnderPointer(event, info, chips.current.get(taskId) ?? null, 'data-day');
    if (day) onSchedule(taskId, day);
  }

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((shownNow) => !shownNow)}
        aria-expanded={open}
        className="label flex items-center gap-1.5 px-1 py-1 hover:text-text-mid"
      >
        <Tray size={13} aria-hidden />
        Unplanned
        <span className="tnum">({tasks.length})</span>
        {planned > 0 && <span className="tnum text-text-faint">{formatWorkMinutes(planned)}</span>}
        <CaretDown
          size={10}
          weight="bold"
          aria-hidden
          className={cn('transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && (
        <>
          <p className="mb-2 px-1 text-xs text-text-lo">
            Drag one onto a day to plan it. The pips show which days have room.
          </p>

          <div className="flex flex-wrap gap-1.5">
            {shown.map((task) => (
              <motion.div
                key={task.id}
                ref={(node) => {
                  if (node) chips.current.set(task.id, node);
                  else chips.current.delete(task.id);
                }}
                drag={!reduced}
                dragSnapToOrigin
                dragMomentum={false}
                whileDrag={{ scale: 1.04, zIndex: 40 }}
                onPointerDown={() => {
                  dragged.current = false;
                }}
                onDragStart={() => {
                  dragged.current = true;
                  setDragging(task.id);
                }}
                onDragEnd={(event, info) => handleDragEnd(task.id, event, info)}
                onClick={() => {
                  if (!dragged.current) onOpen(task.id);
                }}
                title={task.title}
                className={cn(
                  'max-w-[14rem] cursor-grab truncate rounded-md border border-line bg-raised',
                  'px-2 py-1 text-xs text-text-mid',
                  dragging === task.id && 'cursor-grabbing',
                )}
                style={{
                  boxShadow: dragging === task.id ? 'var(--shadow-lifted)' : undefined,
                  // Set on pickup, gone on release. Left in the stylesheet it
                  // would give every chip its own layer.
                  willChange: dragging === task.id ? 'transform' : undefined,
                }}
              >
                {task.title}
                {task.estimateMinutes !== null && (
                  <span className="tnum ml-1.5 text-text-faint">
                    {formatWorkMinutes(task.estimateMinutes)}
                  </span>
                )}
              </motion.div>
            ))}

            {tasks.length > shown.length && (
              <span className="tnum self-center px-1 text-xs text-text-faint">
                +{tasks.length - shown.length} more
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
