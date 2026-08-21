'use client';

import { useRef } from 'react';
import { LIST_SELECTOR, nextRow, ROW_SELECTOR, TOP_ROW_SELECTOR } from '@/lib/keys/cursor';
import { chordIndex, CURSOR_ACTIONS, inScope, typingSafe } from '@/lib/keys/map';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useSelectionStore } from '@/hooks/use-selection';
import { useUiStore } from '@/hooks/use-ui';

const CURSOR_INDEX = chordIndex(inScope(CURSOR_ACTIONS, 'list'));
const CURSOR_TYPING_SAFE = typingSafe(CURSOR_ACTIONS);

/**
 * j and k walk the rows, x picks the one under the cursor, s gives it a subtask.
 *
 * The cursor is DOM focus rather than a stored id, and that choice pays for
 * three things a stored id would have to build. Enter is the focused button's
 * own click, so no handler binds it. Closing a detail panel puts the cursor
 * back on the row that opened it, because `Sheet` restores focus. And the rows
 * are whatever the page holds right now, so a collapsed subtask is skipped
 * without anybody tracking which children show.
 *
 * One cursor for the page, mounted in the shell, not one per list. Bound per
 * list it walked the first list and stopped: every instance registered its own
 * listener, `useHotkeys` calls `preventDefault` before running a handler, so the
 * first list answered every press and the rest saw a press already handled. On
 * the logbook, which mounts a list per day, j reached the end of today and never
 * got to yesterday, and x pressed in any later group selected nothing at all.
 */
export function useListCursor() {
  /**
   * The row the cursor was last on.
   *
   * Focus is the cursor, and focus can be taken: a completed row unmounts under
   * it, and a sheet whose opener is gone by the time it closes drops focus on
   * the body. Without an anchor the next j starts at the top of the page, which
   * for someone working down a list is the one place they are not.
   */
  const anchor = useRef<string | null>(null);

  useHotkeys(CURSOR_INDEX, CURSOR_TYPING_SAFE, (id) => {
    // Any modal sheet owns the keyboard while it is open, and the store knows
    // about three of them. The selection bar's schedule and move sheets, the
    // More menu, the project and area editors and the view builder are all
    // Sheets with no store presence, and moving the cursor behind one pulls
    // focus out of an aria-modal dialog and onto a row behind the scrim.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (useUiStore.getState().palette !== null) return;

    const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
    if (rows.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    // Focus elsewhere on the page is not a cursor. Reading it as one would make
    // j jump from a header button into the middle of the list.
    const onRow = active !== null && rows.includes(active);
    const held = rows.find((row) => row.dataset.rowId === anchor.current) ?? null;

    switch (id) {
      case 'cursor-next':
      case 'cursor-prev': {
        // With focus lost, the first press is "come back", not "move on", so it
        // lands on the anchor rather than past it.
        const target = onRow
          ? nextRow(rows, active, id === 'cursor-next' ? 1 : -1)
          : (held ?? nextRow(rows, null, id === 'cursor-next' ? 1 : -1));
        if (!target) return;
        target.focus();
        anchor.current = target.dataset.rowId ?? null;
        break;
      }

      // Both act on the row the cursor is visibly on. With focus lost they do
      // nothing: acting on a cursor nobody can see is worse than a press that
      // asks to be repeated.
      case 'cursor-pick': {
        if (!onRow || !active.matches(TOP_ROW_SELECTOR)) return;
        const rowId = active.dataset.rowId;
        if (!rowId) return;
        // The order a shift-run spans is the list this row sits in, read in
        // document order, which is the order the list rendered.
        const list = active.closest(LIST_SELECTOR);
        const order = [...(list ?? document).querySelectorAll<HTMLElement>(TOP_ROW_SELECTOR)]
          .map((row) => row.dataset.rowId)
          .filter((value): value is string => value !== undefined);
        useSelectionStore.getState().pick(rowId, order, false);
        break;
      }

      case 'cursor-subtask': {
        if (!onRow || !active.matches(TOP_ROW_SELECTOR)) return;
        const rowId = active.dataset.rowId;
        if (rowId) useUiStore.getState().openTask(rowId, 'subtask');
        break;
      }
    }
  });
}
