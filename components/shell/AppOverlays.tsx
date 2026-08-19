'use client';

import { Toaster } from 'sonner';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { Hotkeys } from '@/components/shell/Hotkeys';
import { InstallPrompt } from '@/components/shell/InstallPrompt';
import { RecoveryNotice } from '@/components/shell/RecoveryNotice';
import { ShortcutsOverlay } from '@/components/shell/ShortcutsOverlay';
import { SyncBadge } from '@/components/shell/SyncBadge';
import { UpdatePrompt } from '@/components/shell/UpdatePrompt';
import { TaskDetailHost } from '@/components/task/TaskDetailHost';
import { useAdoptDeviceTimezone } from '@/hooks/use-prefs';
import { useSelectionStore } from '@/hooks/use-selection';

/**
 * Everything that floats above the views: the detail sheet, the command
 * palette, the sync badge and toasts. The badge is what starts the sync engine,
 * and Hotkeys is the app's only key listener, since this component mounts once
 * for the whole authenticated shell.
 *
 * Sonner is re-skinned through its own CSS variables rather than by overriding
 * its classes, because the variables are the part of its API that is stable
 * across versions. Toasts land on `surface`, so `text-mid` is the floor for
 * anything inside them.
 *
 * The mobile offset clears the bottom nav, and the selection bar when that is
 * up. A toast that reads "Task deleted, Undo" is useless sitting behind the tab
 * bar.
 */
export function AppOverlays() {
  // Mounts once for the shell, which is the right place to notice that the
  // account is still on the server's default timezone.
  useAdoptDeviceTimezone();
  // The selection bar owns the bottom edge while it is up, and it is the thing
  // that raises most of these toasts. A toast sitting on the button that fired
  // it hides the next four.
  const selecting = useSelectionStore((state) => state.active);

  return (
    <>
      <Hotkeys />
      <TaskDetailHost />
      <CommandPalette />
      <ShortcutsOverlay />
      <SyncBadge />
      {/* Registers the service worker as well as prompting, so it has to mount
          above the Toaster it fires into. */}
      <UpdatePrompt />
      <InstallPrompt />
      <RecoveryNotice />
      <Toaster
        theme="dark"
        position="bottom-center"
        // Expanded rather than stacked. A collapsed stack hides all but the
        // newest, and two of the things that go in here are prompts that have to
        // be readable to be answered: "install this" and "a new version is
        // ready" can arrive together, and the second must not bury the first.
        expand
        offset={{ bottom: selecting ? '88px' : '24px' }}
        mobileOffset={{ bottom: selecting ? '152px' : '96px', left: '16px', right: '16px' }}
        style={
          {
            // Sonner ships z-index 999999999, which puts a toast on top of an
            // open sheet. A prompt cannot outrank a dialog the person is in the
            // middle of, so the toaster sits above the page and the nav (20) and
            // the sync badge (30) but under the sheet backdrop (40).
            zIndex: 35,
            '--normal-bg': 'var(--color-surface)',
            '--normal-border': 'var(--color-line-bright)',
            '--normal-text': 'var(--color-text-mid)',
            '--border-radius': 'var(--radius-md)',
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: 'font-sans text-sm',
            actionButton: '!bg-clay-600 !text-text-hi',
          },
        }}
      />
    </>
  );
}
