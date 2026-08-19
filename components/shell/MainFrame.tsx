'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * The content column.
 *
 * Lists read best at a book width and a month grid does not: at 42rem a
 * calendar cell is 90px wide and every task title truncates to three words. So
 * width is a property of the view rather than of the shell, decided here by
 * route so no page has to remember to wrap itself.
 *
 * A client component inside the server layout, which costs nothing: the sidebar
 * is already one, and `usePathname` resolves during the server render, so the
 * class is in the first HTML rather than applied a frame later.
 */
const WIDE_VIEWS = new Set(['/calendar', '/board', '/review']);

export function MainFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <main
      className={cn(
        'safe-top safe-x mx-auto w-full px-4 pb-28 pt-6 md:pb-10 md:pt-10',
        WIDE_VIEWS.has(pathname) ? 'max-w-5xl' : 'max-w-2xl',
      )}
    >
      {children}
    </main>
  );
}
