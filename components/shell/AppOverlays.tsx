'use client';

import { Toaster } from 'sonner';
import { TaskDetailHost } from '@/components/task/TaskDetailHost';

/**
 * Everything that floats above the views: the detail sheet and toasts.
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
  return (
    <>
      <TaskDetailHost />
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
