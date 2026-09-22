'use client';

import { useEffect, useRef, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion, type PanInfo } from 'motion/react';
import { ArrowElbowDownRight } from '@phosphor-icons/react/dist/ssr';
import { LIFT, ROW } from '@/lib/motion';
import { columnIsoDay, monthGrid, weekdayLabels, type Month } from '@/lib/calendar/grid';
import { addDays } from '@/lib/db/queries';
import { targetUnderPointer } from '@/lib/dnd/drop';
import { CALENDAR_ACTIONS, chordIndex, inScope, typingSafe } from '@/lib/keys/map';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { MD_QUERY, useMediaQuery } from '@/hooks/use-media-query';
import { NO_PARENT, type CourseEvent, type PlainDate, type Task } from '@/lib/db/types';
import type { LoadState } from '@/lib/workload/forecast';
import { cn } from '@/lib/utils';

/**
 * The month grid.
 *
 * Rescheduling is a drag on wide screens and a tap on narrow ones, because the
 * two layouts hold different objects. A phone cell is 50px across and shows dots
 * rather than titles, so there is nothing to grab; the phone reschedules through
 * the day list under the grid. Dragging a dot would also fight the page scroll,
 * which is the gesture people want over a grid that tall.
 *
 * The drop target is hit-tested from the pointer rather than tracked with hover
 * handlers, so a drag that leaves the grid is a no-op instead of landing on the
 * last cell it crossed.
 *
 * The arrow keys work the grid, which is what `role="grid"` had been claiming
 * with nothing behind it. One cell is in the tab order at a time, the selected
 * one, so the month is a single stop on the way down the page rather than
 * forty-two of them. A move selects the day it lands on, so the list under the
 * grid follows the cursor, and a move past either edge pages the month instead
 * of stopping at the border.
 *
 * The bindings are live only while focus is inside the grid. The dispatcher
 * calls `preventDefault` on any chord it matches, so an arrow bound wider than
 * this would take scrolling off the page.
 */

const CALENDAR_INDEX = chordIndex(inScope(CALENDAR_ACTIONS, 'calendar'));
const CALENDAR_TYPING_SAFE = typingSafe(CALENDAR_ACTIONS);

/** How many days a binding moves. Up and down are a week. */
const STEP: Record<string, number> = {
  'calendar-day-back': -1,
  'calendar-day-on': 1,
  'calendar-week-back': -7,
  'calendar-week-on': 7,
};

interface CalendarMonthProps {
  month: Month;
  weekStart: number;
  tasksByDay: Map<PlainDate, Task[]>;
  selected: PlainDate;
  todayDate: PlainDate;
  onSelect: (day: PlainDate) => void;
  onMove: (taskId: string, day: PlainDate) => void;
  onOpen: (taskId: string) => void;
  /** Lectures, exams and office hours, by day. Read-only, so they render behind
   *  the day rather than as anything you can pick up or tick off. */
  eventsByDay?: Map<PlainDate, CourseEvent[]>;
  /** How loaded each day is. A pip rather than a bar: a month of bars is a
   *  smear, and the state is the part that changes a decision. */
  loadByDay?: Map<PlainDate, LoadState>;
  /** Title by parent id, for the subtasks in `tasksByDay`. A chip is eleven
   *  pixels of truncated title, so the parent goes in the tooltip rather than
   *  on the face of it. */
  parentTitles?: Map<string, string>;
  /** ISO weekdays that carry capacity. The days outside it are drawn back, so
   *  the grid reads as weeks of working time rather than forty-two equal boxes. */
  workDays?: readonly number[];
}

/** Chips beyond this become a "+N" line. Three fits a 104px cell. */
const MAX_CHIPS = 3;
const MAX_DOTS = 4;

/**
 * The phone's version of a chip.
 *
 * A subtask is a ring rather than a fill, at the same size, so a row of dots
 * stays even. The phone cell carries no titles at all, so this is a hint and the
 * day list under the grid is where it is spelled out.
 */
function dotClass(task: Task, todayDate: PlainDate): string {
  const child = task.parentTaskId !== NO_PARENT;
  if (task._done === 1) return child ? 'border border-olive-400' : 'bg-olive-400';
  if (task._dueDay < todayDate) return child ? 'border border-clay-400' : 'bg-clay-400';
  return child ? 'border border-sand-400' : 'bg-sand-400';
}

function chipClass(task: Task, todayDate: PlainDate): string {
  if (task._done === 1) return 'text-text-lo line-through';
  if (task._dueDay < todayDate) return 'text-clay-200';
  return 'text-text-mid';
}

export function CalendarMonth({
  month,
  weekStart,
  tasksByDay,
  selected,
  todayDate,
  onSelect,
  onMove,
  onOpen,
  eventsByDay,
  loadByDay,
  parentTitles,
  workDays,
}: CalendarMonthProps) {
  const wide = useMediaQuery(MD_QUERY);
  const reduced = useReducedMotion();
  const weeks = monthGrid(month, weekStart);
  const headings = weekdayLabels(weekStart);
  /**
   * The cell that holds the tab stop, and where a keyboard move starts from.
   *
   * The selected day, unless it is not on screen. The header's month buttons page
   * the grid without moving the selection, so September can be showing while
   * August 21 is selected, and keying the tab stop off the selection alone would
   * leave that grid with no way in from the keyboard at all.
   */
  const roving =
    weeks.flat().find((cell) => cell.date === selected)?.date ??
    weeks.flat().find((cell) => cell.inMonth)?.date ??
    selected;
  const [dragging, setDragging] = useState<string | null>(null);
  const chips = useRef(new Map<string, HTMLElement>());
  const grid = useRef<HTMLDivElement>(null);
  /**
   * The day the keyboard asked for, held until a cell for it exists.
   *
   * A move that leaves the six weeks on screen pages the month, and the whole
   * grid is rebuilt around the new one, so the cell to focus is not in the DOM
   * at the moment the key is pressed. Held in a ref rather than state: nothing
   * renders differently for it, and it is cleared by the effect that spends it.
   */
  const wanted = useRef<PlainDate | null>(null);
  // A drop is followed by a click on the chip, and the browser dispatches it
  // before motion reports the drag ended, so the flag has to be raised on
  // pickup. Otherwise the detail panel opens every time anything is dragged.
  // Cleared on the next press, so a swallowed click cannot swallow the one
  // after it as well.
  const dragged = useRef(false);

  useEffect(() => {
    const day = wanted.current;
    if (!day) return;
    const cell = grid.current?.querySelector<HTMLElement>(`[data-day-cell="${day}"]`);
    // Left in place when the cell is still missing, so the next render tries
    // again rather than dropping the cursor on the body.
    if (!cell) return;
    wanted.current = null;
    cell.focus();
  }, [month, selected]);

  useHotkeys(
    CALENDAR_INDEX,
    CALENDAR_TYPING_SAFE,
    (id) => {
      const step = STEP[id];
      if (step === undefined) return;
      // From the cell the cursor is on, or from the tab stop when focus reached
      // the grid some other way.
      const from = (document.activeElement as HTMLElement | null)?.dataset.dayCell ?? roving;
      const to = addDays(from, step);
      wanted.current = to;
      onSelect(to);
    },
    () => grid.current?.contains(document.activeElement) === true,
  );

  /** Whether a column's weekday carries no capacity. */
  function offDuty(column: number): boolean {
    return workDays !== undefined && !workDays.includes(columnIsoDay(weekStart, column));
  }

  function handleDragEnd(
    taskId: string,
    event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) {
    setDragging(null);
    const day = targetUnderPointer(event, info, chips.current.get(taskId) ?? null, 'data-day');
    if (day) onMove(taskId, day);
  }

  /**
   * One task in a cell, on a wide screen.
   *
   * A subtask carries the same elbow the day list puts on it, so a deadline that
   * came out of a bigger piece of work says so with one glyph in both places
   * rather than a second visual language per view. The parent's name goes in the
   * tooltip: the chip is eleven pixels of already truncated title.
   *
   * Dragging a subtask chip moves that subtask's own date, which is the whole
   * reason it is on the grid separately from its parent.
   */
  function chip(task: Task) {
    const child = task.parentTaskId !== NO_PARENT;
    const parent = child ? parentTitles?.get(task.parentTaskId) : undefined;

    return (
      <motion.div
        key={task.id}
        ref={(node) => {
          if (node) chips.current.set(task.id, node);
          else chips.current.delete(task.id);
        }}
        layoutId={`cal-chip-${task.id}`}
        transition={dragging === task.id ? LIFT : ROW}
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
        title={parent ? `${task.title}, in ${parent}` : task.title}
        className={cn(
          'flex cursor-grab items-center gap-1 rounded-[5px] border border-line bg-raised',
          'px-1.5 py-0.5 text-[0.6875rem] leading-tight',
          dragging === task.id && 'cursor-grabbing',
          chipClass(task, todayDate),
        )}
        style={{
          boxShadow: dragging === task.id ? 'var(--shadow-lifted)' : undefined,
          // Set on pickup, gone on release. Left in the
          // stylesheet it would give every chip its own layer.
          willChange: dragging === task.id ? 'transform' : undefined,
        }}
      >
        {child && (
          <ArrowElbowDownRight
            size={9}
            weight="bold"
            aria-hidden
            className="shrink-0 text-text-faint"
          />
        )}
        <span className="min-w-0 truncate">{task.title}</span>
      </motion.div>
    );
  }

  return (
    <div ref={grid} role="grid" aria-label={`Month of ${month}`} className="select-none">
      <div role="row" className="mb-1.5 grid grid-cols-7 gap-1">
        {headings.map((heading, column) => (
          <div
            key={heading}
            role="columnheader"
            className={cn(
              'label !text-[0.5625rem] text-center',
              // A day with no capacity is named quieter. The signal lives on the
              // heading rather than in the cell's fill because there is no fifth
              // surface to spend: `surface` over `void` is two points of
              // lightness apart in the light ramp, so a tinted cell there is a
              // difference nobody can see.
              offDuty(column) && 'text-text-faint',
            )}
          >
            {heading}
          </div>
        ))}
      </div>

      <LayoutGroup>
        <div className="grid gap-1">
          {weeks.map((week) => (
            <div key={week[0]!.date} role="row" className="grid grid-cols-7 gap-1">
              {week.map((cell) => {
                const rows = tasksByDay.get(cell.date) ?? [];
                const isToday = cell.date === todayDate;
                const isSelected = cell.date === selected;
                const open = rows.filter((t) => t._done === 0).length;

                return (
                  <div
                    key={cell.date}
                    role="gridcell"
                    data-day={cell.date}
                    aria-selected={isSelected}
                    className={cn(
                      'relative flex min-h-[3.25rem] flex-col rounded-md border p-1 md:min-h-[6.5rem] md:p-1.5',
                      // A borrowed cell keeps its place and its outline drops to
                      // a hairline, so the month on screen reads as the block it
                      // is. Taken away altogether, the last row of a grid that is
                      // all next month became numbers floating under the grid.
                      cell.inMonth ? 'border-line/60' : 'border-line/20',
                      cell.inMonth ? 'bg-surface/50' : 'bg-transparent',
                      // The wash rather than the border alone. On the day that is
                      // both today and selected, a clay border around a clay
                      // number said nothing the number had not already said.
                      isSelected && 'border-clay-400 bg-clay-600/[0.07]',
                    )}
                  >
                    {/* The target sits under the chips rather than wrapping them.
                        Wrapping would fold every chip title into the day's
                        accessible name and nest one control inside another. */}
                    <button
                      type="button"
                      data-day-cell={cell.date}
                      // One cell in the tab order, the selected one, with the
                      // arrows covering the other forty-one. The roving stays
                      // honest because a keyboard move selects where it lands.
                      tabIndex={cell.date === roving ? 0 : -1}
                      onClick={() => onSelect(cell.date)}
                      className="absolute inset-0 rounded-md"
                      aria-label={`${cell.date}, ${open} open ${open === 1 ? 'task' : 'tasks'}`}
                    />

                    {/* Bottom right, away from the day number and the chips.
                        Only a day that is full or over says anything: a pip on
                        every cell is a pattern rather than a signal. */}
                    {(() => {
                      const state = loadByDay?.get(cell.date);
                      if (state !== 'full' && state !== 'over') return null;
                      return (
                        <span
                          aria-hidden
                          className={cn(
                            'pointer-events-none absolute bottom-1 right-1 size-1.5 rounded-full',
                            state === 'over' ? 'bg-clay-400' : 'bg-sand-400',
                          )}
                        />
                      );
                    })()}

                    {/* Behind the number and under the chips. A class is not
                        work: there is nothing to tick off and nothing to drag,
                        so it reads as a property of the day. */}
                    {(eventsByDay?.get(cell.date)?.length ?? 0) > 0 && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded-full bg-olive-400/40"
                      />
                    )}

                    <span
                      className={cn(
                        'tnum pointer-events-none relative mx-auto flex size-[1.375rem] shrink-0',
                        'items-center justify-center rounded-full text-xs md:mx-0',
                        isToday && 'bg-clay-600 text-on-accent',
                        !isToday && (cell.inMonth ? 'text-text-mid' : 'text-text-faint'),
                      )}
                    >
                      {cell.day}
                    </span>

                    {wide ? (
                      <div className="relative mt-1 flex min-h-0 flex-col gap-0.5">
                        {rows.slice(0, MAX_CHIPS).map((task) => chip(task))}
                        {rows.length > MAX_CHIPS && (
                          <span className="pointer-events-none px-1 text-[0.625rem] text-text-lo">
                            +{rows.length - MAX_CHIPS} more
                          </span>
                        )}
                      </div>
                    ) : (
                      rows.length > 0 && (
                        <div className="pointer-events-none relative mt-auto flex flex-wrap justify-center gap-[3px] pb-0.5">
                          {rows.slice(0, MAX_DOTS).map((task) => (
                            <span
                              key={task.id}
                              className={cn('size-1.5 rounded-full', dotClass(task, todayDate))}
                            />
                          ))}
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}
