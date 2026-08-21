'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LayoutGroup, motion, useReducedMotion, type PanInfo } from 'motion/react';
import { ArrowsOutCardinal, CalendarBlank, Flag } from '@phosphor-icons/react/dist/ssr';
import { Sheet } from '@/components/ui/Sheet';
import { cardAcross, cardAlong, columnBeside, locate } from '@/lib/board/cursor';
import { targetUnderPointer } from '@/lib/dnd/drop';
import { formatClock, formatDueLabel } from '@/lib/format/date';
import { BOARD_ACTIONS, chordIndex, inScope, typingSafe } from '@/lib/keys/map';
import { LIFT, ROW } from '@/lib/motion';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { MD_QUERY, useMediaQuery } from '@/hooks/use-media-query';
import type { BoardColumn } from '@/lib/board/columns';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import { cn } from '@/lib/utils';

/**
 * Columns of cards, dragged between.
 *
 * Every card also carries a move button. It is what a screen reader uses, and it
 * is what a phone uses: the board scrolls sideways, so a touch drag would have to
 * win a fight with the scroller on every pickup. Drag is the shortcut on a
 * pointer, the button is the interface.
 *
 * From a keyboard the arrows walk the cards and shift plus an arrow moves the one
 * under the cursor, which is the gesture the drag stands in for. Focus follows
 * the card into its new column: the card is rebuilt there by a live query, so the
 * id to chase is held until the columns say it landed. Both are live only while
 * focus is inside the board, or the dispatcher would take the arrow keys off
 * every page.
 */

const BOARD_INDEX = chordIndex(inScope(BOARD_ACTIONS, 'board'));
const BOARD_TYPING_SAFE = typingSafe(BOARD_ACTIONS);

interface BoardProps {
  columns: BoardColumn[];
  todayDate: string;
  onMove: (taskId: string, columnId: string) => void;
  onOpen: (taskId: string) => void;
}

export function Board({ columns, todayDate, onMove, onOpen }: BoardProps) {
  const wide = useMediaQuery(MD_QUERY);
  const reduced = useReducedMotion();
  const [dragging, setDragging] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ task: Task; columnId: string } | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const board = useRef<HTMLDivElement>(null);
  /**
   * The card a keyboard move sent somewhere, and the column it was sent to.
   *
   * Held rather than focused on the spot because the move is a database write: the
   * card is unmounted from one column and rebuilt in another when the live query
   * comes back, which is one or more renders later. Cleared once the columns agree
   * the card arrived, so a render in between does not spend the chase early.
   */
  const chasing = useRef<{ taskId: string; columnId: string } | null>(null);
  // The click after a drop arrives before motion reports the drag ended, so the
  // flag goes up on pickup and comes down on the next press.
  const dragged = useRef(false);

  function focusCard(taskId: string) {
    board.current
      ?.querySelector<HTMLElement>(`[data-card="${taskId}"] [data-card-title]`)
      ?.focus();
  }

  useEffect(() => {
    const chase = chasing.current;
    if (!chase) return;
    const spot = locate(columns, chase.taskId);
    // Not landed yet, or gone from the board altogether. Either way there is
    // nothing to put the cursor on this time round.
    if (!spot) return;
    if (columns[spot.column]?.id !== chase.columnId) return;
    chasing.current = null;
    focusCard(chase.taskId);
  }, [columns]);

  useHotkeys(
    BOARD_INDEX,
    BOARD_TYPING_SAFE,
    (id) => {
      const from = (document.activeElement as HTMLElement | null)
        ?.closest<HTMLElement>('[data-card]')
        ?.dataset.card;
      if (!from) return;

      switch (id) {
        case 'board-card-up':
        case 'board-card-down': {
          const to = cardAlong(columns, from, id === 'board-card-down' ? 1 : -1);
          if (to) focusCard(to);
          break;
        }
        case 'board-card-left':
        case 'board-card-right': {
          const to = cardAcross(columns, from, id === 'board-card-right' ? 1 : -1);
          if (to) focusCard(to);
          break;
        }
        case 'board-move-left':
        case 'board-move-right': {
          const to = columnBeside(columns, from, id === 'board-move-right' ? 1 : -1);
          if (!to) return;
          chasing.current = { taskId: from, columnId: to };
          onMove(from, to);
          break;
        }
      }
    },
    // A card has to hold the cursor for any of it to mean anything, and the
    // guard runs before the press is swallowed.
    () =>
      board.current?.contains(document.activeElement) === true &&
      document.activeElement?.closest('[data-card]') !== null,
  );

  function handleDragEnd(
    taskId: string,
    event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) {
    setDragging(null);
    const column = targetUnderPointer(event, info, cards.current.get(taskId) ?? null, 'data-column');
    if (column !== null) onMove(taskId, column);
  }

  return (
    <>
      <div ref={board} className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
        <LayoutGroup>
          {columns.map((column) => (
            <section
              key={column.id}
              data-column={column.id}
              className={cn(
                'flex w-[15.5rem] shrink-0 flex-col gap-2 rounded-lg border border-line/60',
                // Tall whether or not it holds anything: an empty column that
                // shrinks to its header is a drop target you cannot hit.
                'min-h-[18rem] bg-surface/40 p-2',
              )}
            >
              <header className="flex items-baseline justify-between px-1">
                <h2 className="text-sm text-text-mid">{column.title}</h2>
                <span className="tnum text-xs text-text-lo">{column.tasks.length}</span>
              </header>

              <ul className="flex flex-1 flex-col gap-2">
                {column.tasks.map((task) => {
                  const overdue =
                    task._done === 0 && task._dueDay !== NO_DUE_DAY && task._dueDay < todayDate;

                  return (
                    <motion.li
                      key={task.id}
                      data-card={task.id}
                      ref={(node) => {
                        if (node) cards.current.set(task.id, node);
                        else cards.current.delete(task.id);
                      }}
                      layoutId={`board-card-${task.id}`}
                      transition={dragging === task.id ? LIFT : ROW}
                      drag={wide && !reduced}
                      dragSnapToOrigin
                      dragMomentum={false}
                      whileDrag={{ scale: 1.03, zIndex: 40 }}
                      onPointerDown={() => {
                        dragged.current = false;
                      }}
                      onDragStart={() => {
                        dragged.current = true;
                        setDragging(task.id);
                      }}
                      onDragEnd={(event, info) => handleDragEnd(task.id, event, info)}
                      className={cn(
                        'list-none rounded-md border border-line bg-surface p-2.5',
                        wide && 'cursor-grab',
                        dragging === task.id && 'cursor-grabbing',
                      )}
                      style={{
                        boxShadow:
                          dragging === task.id ? 'var(--shadow-lifted)' : 'var(--shadow-flush)',
                        willChange: dragging === task.id ? 'transform' : undefined,
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          data-card-title
                          onClick={() => {
                            if (!dragged.current) onOpen(task.id);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span
                            className={cn(
                              'block text-[0.8125rem] leading-snug',
                              task._done === 1 ? 'text-text-lo line-through' : 'text-text-hi',
                            )}
                          >
                            {task.title}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            // Guarded like the title: a drag released over this
                            // button fires a click on it, and a move sheet
                            // opening on its own after a drop reads as a bug.
                            if (!dragged.current) setMoving({ task, columnId: column.id });
                          }}
                          aria-label={`Move ${task.title} to another column`}
                          className="shrink-0 rounded p-0.5 text-text-faint hover:text-text-mid"
                        >
                          <ArrowsOutCardinal size={14} aria-hidden />
                        </button>
                      </div>

                      {(task._dueDay !== NO_DUE_DAY || task.priority > 0) && (
                        <div className="mt-1.5 flex items-center gap-2.5">
                          {task._dueDay !== NO_DUE_DAY && (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 text-[0.6875rem]',
                                overdue ? 'text-clay-200' : 'text-text-lo',
                              )}
                            >
                              <CalendarBlank size={11} aria-hidden />
                              <span className="tnum">
                                {formatDueLabel(task._dueDay, todayDate)}
                                {task.dueTime ? ` ${formatClock(task.dueTime)}` : ''}
                              </span>
                            </span>
                          )}
                          {task.priority > 0 && (
                            <span className="inline-flex items-center gap-1 text-[0.6875rem] text-clay-300">
                              <Flag size={11} weight="fill" aria-hidden />
                              <span className="tnum">P{4 - task.priority}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </motion.li>
                  );
                })}
              </ul>

              {column.more && (
                <Link
                  href={column.more.href}
                  className={cn(
                    'label mt-auto rounded-md px-1 py-1 !text-[0.5625rem]',
                    'hover:text-text-mid',
                  )}
                >
                  {column.more.label}
                </Link>
              )}
            </section>
          ))}
        </LayoutGroup>
      </div>

      <Sheet open={moving !== null} onClose={() => setMoving(null)} label="Move task">
        {moving && (
          <div className="pt-1">
            <p className="label mb-1">Move to</p>
            <p className="mb-3 truncate text-sm text-text-mid">{moving.task.title}</p>
            <ul className="space-y-1">
              {columns.map((column) => (
                <li key={column.id}>
                  <button
                    type="button"
                    disabled={column.id === moving.columnId}
                    onClick={() => {
                      onMove(moving.task.id, column.id);
                      setMoving(null);
                    }}
                    className={cn(
                      'w-full rounded-lg border px-3 py-3 text-left text-[0.9375rem]',
                      column.id === moving.columnId
                        ? 'border-line/60 text-text-faint'
                        : 'border-line bg-surface text-text-mid',
                    )}
                  >
                    {column.title}
                    {column.id === moving.columnId && (
                      <span className="label ml-2 !text-[0.5625rem]">here now</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>
    </>
  );
}
