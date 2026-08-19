'use client';

import { Toaster } from 'sonner';
import { SyncBadge } from '@/components/shell/SyncBadge';
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
      <Toaster
        theme="dark"
        position="bottom-center"
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
