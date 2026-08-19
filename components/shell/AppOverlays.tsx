'use client';

import { Toaster } from 'sonner';
import { InstallPrompt } from '@/components/shell/InstallPrompt';
import { SyncBadge } from '@/components/shell/SyncBadge';
import { UpdatePrompt } from '@/components/shell/UpdatePrompt';
import { TaskDetailHost } from '@/components/task/TaskDetailHost';
import { useAdoptDeviceTimezone } from '@/hooks/use-prefs';

/**
 * Everything that floats above the views: the detail sheet, the sync badge
 * and toasts. The badge is what starts the sync engine, since this component
 * mounts once for the whole authenticated shell.
 *
 * Sonner is re-skinned through its own CSS variables rather than by overriding
 * its classes, because the variables are the part of its API that is stable
 * across versions. Toasts land on `surface`, so `text-mid` is the floor for
 * anything inside them.
 *
 * The mobile offset clears the bottom nav. A toast that reads "Task deleted,
 * Undo" is useless sitting behind the tab bar.
 */
export function AppOverlays() {
  // Mounts once for the shell, which is the right place to notice that the
  // account is still on the server's default timezone.
  useAdoptDeviceTimezone();

  return (
    <>
      <TaskDetailHost />
      <SyncBadge />
      {/* Registers the service worker as well as prompting, so it has to mount
          above the Toaster it fires into. */}
      <UpdatePrompt />
      <InstallPrompt />
      <Toaster
        theme="dark"
        position="bottom-center"
        // Expanded rather than stacked. A collapsed stack hides all but the
        // newest, and two of the things that go in here are prompts that have to
        // be readable to be answered: "install this" and "a new version is
        // ready" can arrive together, and the second must not bury the first.
        expand
        offset={{ bottom: '24px' }}
        mobileOffset={{ bottom: '96px', left: '16px', right: '16px' }}
        style={
          {
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
