'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { undoLast } from '@/lib/db/undo';
import { CHORD_INDEX, TYPING_SAFE, routeFor } from '@/components/shell/keymap';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useSelectionStore } from '@/hooks/use-selection';
import { useUiStore } from '@/hooks/use-ui';

/**
 * The one place a key press turns into an action.
 *
 * Renders nothing. It mounts in the shell overlays so the listener outlives
 * every view, which is the difference between a shortcut and a per-screen
 * keybinding.
 */
export function Hotkeys() {
  const router = useRouter();

  const run = useCallback(
    (id: string) => {
      const route = routeFor(id);
      if (route) {
        router.push(route);
        return;
      }

      // Read through getState rather than subscribing: this component renders
      // nothing, so a re-render per palette open would buy nothing.
      const ui = useUiStore.getState();

      switch (id) {
        case 'palette':
          // Toggles, because the shortcut that opens a thing is the one people
          // press again to get rid of it.
          if (ui.palette) ui.closePalette();
          else ui.openPalette('commands');
          break;
        case 'search':
          ui.openPalette('search');
          break;
        case 'shortcuts':
          ui.setShortcutsOpen(!ui.shortcutsOpen);
          break;
        case 'new-task':
          focusQuickAdd(router);
          break;
        case 'select-mode':
          useSelectionStore.getState().begin();
          break;
        case 'undo':
          void undoLast().then((took) =>
            toast(took ? `Undid: ${took}` : 'Nothing to undo'),
          );
          break;
      }
    },
    [router],
  );

  useHotkeys(CHORD_INDEX, TYPING_SAFE, run);
  return null;
}

/**
 * Put the cursor in a quick-add field.
 *
 * Most views have one. The ones that do not (the board, the calendar's own
 * field aside, the review) send the user to Today, and the store carries the
 * intent across the navigation because the field being focused does not exist
 * yet at the moment the key is pressed.
 */
function focusQuickAdd(router: ReturnType<typeof useRouter>) {
  const field = document.querySelector<HTMLInputElement>('[data-quick-add]');
  if (field) {
    field.focus();
    field.select();
    return;
  }
  useUiStore.getState().wantQuickAdd();
  router.push('/today');
}
