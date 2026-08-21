'use client';

import type { RefObject } from 'react';
import { nextRow, ROW_SELECTOR } from '@/lib/keys/cursor';
import { chordIndex, CURSOR_ACTIONS, inScope, typingSafe } from '@/lib/keys/map';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useUiStore } from '@/hooks/use-ui';

const CURSOR_INDEX = chordIndex(inScope(CURSOR_ACTIONS, 'list'));
const CURSOR_TYPING_SAFE = typingSafe(CURSOR_ACTIONS);

/**
 * j and k walk the rows, x picks the one under the cursor.
 *
 * The cursor is DOM focus rather than a stored id, and that choice pays for
 * three things a stored id would have to build. Enter is the focused button's
 * own click, so no handler binds it. `Sheet` already returns focus to whatever
 * opened it, so closing a task detail puts the cursor back on the row it came
 * from. And the rows in view are whatever the container holds right now, so a
 * collapsed subtask is skipped without anybody tracking which children show.
 *
 * Bound by the list rather than in the app map, which is what `scope: 'list'`
 * means. The rows are the only reason these keys have anything to do.
 */
export function useListCursor(
  container: RefObject<HTMLElement | null>,
  /** Called with the task id under the cursor. The list decides what a pick
   *  means, since it owns the order a range spans. */
  onPick: (id: string) => void,
) {
  useHotkeys(CURSOR_INDEX, CURSOR_TYPING_SAFE, (id) => {
    // A sheet owns the keyboard while it is open. Without this, j behind an open
    // detail panel drags focus out of the dialog and into the list under it, and
    // the panel's Escape then closes a sheet the cursor has already left.
    const ui = useUiStore.getState();
    if (ui.openTaskId !== null || ui.palette !== null || ui.shortcutsOpen) return;

    const node = container.current;
    if (!node) return;

    const rows = [...node.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
    const active = document.activeElement as HTMLElement | null;
    // Focus elsewhere on the page is not a cursor. Reading it as one would make
    // j jump from a header button into the middle of the list.
    const current = active && rows.includes(active) ? active : null;

    switch (id) {
      case 'cursor-next':
        nextRow(rows, current, 1)?.focus();
        break;
      case 'cursor-prev':
        nextRow(rows, current, -1)?.focus();
        break;
      case 'cursor-pick': {
        const rowId = current?.dataset.rowId;
        if (rowId) onPick(rowId);
        break;
      }
    }
  });
}
