'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * The content column.
 *
 * Lists read best at a book width and a month grid does not: at 42rem a
 * calendar cell is 90px wide and every task title truncates to three words. The
 * board wants the room for the same reason. Everything else, the review
 * included, reads better narrow, since a chart stretched to 64rem is mostly
 * whitespace. So width is a property of the view rather than of the shell,
 * decided here by route so no page has to remember to wrap itself.
 *
 * A client component inside the server layout, which costs nothing: the sidebar
 * is already one, and `usePathname` resolves during the server render, so the
 * class is in the first HTML rather than applied a frame later.
 */
const WIDE_VIEWS = new Set(['/calendar', '/board']);

export function MainFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <main
      className={cn(
        'mx-auto w-full pb-28 md:pb-10',
        // The safe-area insets are folded into the padding rather than added by
        // a .safe-* class. Those live in @layer base, so ANY Tailwind padding
        // utility on the same element wins the cascade and the inset silently
        // does nothing: this element had `safe-top` and `pt-6` together, and on
        // a notched iPhone the eyebrow rendered under the status bar.
        'pt-[calc(1.5rem+env(safe-area-inset-top))] md:pt-[calc(2.5rem+env(safe-area-inset-top))]',
        'pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))]',
        WIDE_VIEWS.has(pathname) ? 'max-w-5xl' : 'max-w-2xl',
      )}
    >
      {children}
    </main>
  );
}
