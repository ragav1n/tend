'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { Archive, CalendarDots, Sun, Tray } from '@phosphor-icons/react/dist/ssr';
import { APP_NAME } from '@/lib/config';
import { SOFT } from '@/lib/motion';
import { useSidebarCounts } from '@/hooks/use-tasks';
import { cn } from '@/lib/utils';

/**
 * Navigation. Doubles as the mobile bottom bar, since the same four
 * destinations matter on both and maintaining two lists guarantees they drift.
 *
 * The active indicator is a single shared element moved with `layoutId`, so it
 * slides between items rather than cross-fading. That is the cheapest place in
 * the app to spend a layout animation and the most legible.
 */

const NAV = [
  { href: '/today', label: 'Today', icon: Sun, count: 'today' as const },
  { href: '/upcoming', label: 'Upcoming', icon: CalendarDots, count: 'upcoming' as const },
  { href: '/inbox', label: 'Inbox', icon: Tray, count: 'inbox' as const },
  { href: '/someday', label: 'Someday', icon: Archive, count: null },
];

export function Sidebar() {
  const pathname = usePathname();
  const counts = useSidebarCounts();

  return (
    <nav
      aria-label="Views"
      className={cn(
        // Bottom bar on phones, rail on anything wider.
        'safe-bottom safe-x fixed inset-x-0 bottom-0 z-20 flex items-stretch gap-1',
        'border-t border-line bg-surface/95 px-2 py-1.5 backdrop-blur-xl',
        'md:safe-top md:inset-y-0 md:right-auto md:left-0 md:w-[232px] md:flex-col',
        'md:items-stretch md:border-t-0 md:border-r md:bg-void/60 md:px-3 md:py-5',
      )}
    >
      <div className="hidden md:mb-6 md:block md:px-2">
        <span className="font-display text-2xl text-text-hi">{APP_NAME}</span>
        <p className="label mt-1 !text-[0.5625rem]">Look after what needs doing</p>
      </div>

      {NAV.map((item) => {
        const active = pathname === item.href;
        const count = item.count ? counts[item.count] : 0;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-0.5 rounded-md px-2 py-1.5',
              'md:flex-none md:flex-row md:gap-2.5 md:px-3 md:py-2',
              active ? 'text-text-hi' : 'text-text-lo hover:text-text-mid',
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                aria-hidden
                className="absolute inset-0 rounded-md border border-line-bright bg-raised"
                transition={SOFT}
              />
            )}
            <Icon
              size={19}
              weight={active ? 'fill' : 'regular'}
              className={cn('relative', active && 'text-clay-300')}
              aria-hidden
            />
            <span className="relative text-[0.6875rem] md:flex-1 md:text-left md:text-sm">
              {item.label}
            </span>
            {count > 0 && (
              <span className="tnum relative hidden text-xs text-text-lo md:inline">{count}</span>
            )}
            {/* On the bottom bar there is no room for a number, so overdue work
                shows as a dot instead of being hidden entirely. */}
            {item.count === 'today' && counts.overdue > 0 && (
              <span
                aria-label={`${counts.overdue} overdue`}
                className="absolute right-1.5 top-1 size-1.5 rounded-full bg-clay-400 md:hidden"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
