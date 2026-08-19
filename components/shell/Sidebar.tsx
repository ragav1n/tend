'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { DotsThree, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { APP_NAME } from '@/lib/config';
import { MarkTile } from '@/components/brand/Mark';
import { MoreMenu } from '@/components/shell/MoreMenu';
import { BAR_ITEMS, LISTS, MORE_ITEMS, SETTINGS, TOOLS, type NavItem } from '@/components/shell/nav';
import { CHORD_FOR } from '@/components/shell/keymap';
import { Chord } from '@/components/ui/Kbd';
import { SOFT } from '@/lib/motion';
import { useSidebarCounts } from '@/hooks/use-tasks';
import { useUiStore } from '@/hooks/use-ui';
import { cn } from '@/lib/utils';

/**
 * Navigation: a rail on wide screens, a bottom bar on phones.
 *
 * They were one responsive element until the calendar landed. A phone bar holds
 * four destinations before the labels stop being readable, and the app now has
 * nine, so the bar carries the four that get opened daily and More carries the
 * rest. The rail keeps everything, grouped: lists are what is on the plate,
 * tools are ways of working through it.
 *
 * The active indicator is one shared element moved with `layoutId`, so it slides
 * between items. The rail and the bar use different ids because both are in the
 * DOM at once and a shared id would make them fight over the same pill.
 */

function countFor(item: NavItem, counts: ReturnType<typeof useSidebarCounts>): number {
  return item.count ? counts[item.count] : 0;
}

function RailLink({ item, active, count }: { item: NavItem; active: boolean; count: number }) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-md px-3 py-2',
        active ? 'text-text-hi' : 'text-text-lo hover:text-text-mid',
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active-rail"
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
      <span className="relative flex-1 text-sm">{item.label}</span>
      {count > 0 && <span className="tnum relative text-xs text-text-lo">{count}</span>}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const counts = useSidebarCounts();
  const openPalette = useUiStore((state) => state.openPalette);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_ITEMS.some((item) => item.href === pathname);

  return (
    <>
      <nav
        aria-label="Views"
        className={cn(
          'safe-top hidden md:fixed md:inset-y-0 md:left-0 md:z-20 md:flex md:w-[232px]',
          'md:flex-col md:border-r md:border-line md:bg-void/60 md:px-3 md:pt-5',
          // A reservation, not spacing. SyncBadge is fixed at the foot of the
          // rail and cannot know what the rail put there, so the rail keeps that
          // row empty. Without it the badge sits on top of Settings.
          'md:pb-16',
        )}
      >
        <div className="mb-6 px-2">
          <span className="flex items-center gap-2.5">
            <MarkTile size={26} />
            <span className="font-display text-2xl text-text-hi">{APP_NAME}</span>
          </span>
          <p className="label mt-1 !text-[0.5625rem]">Look after what needs doing</p>
        </div>

        {/* The palette's only pointer entry. It is drawn as a field because that
            is what people click when they want to search, and the cap says the
            shortcut once rather than hiding it in a help screen. */}
        <button
          type="button"
          onClick={() => openPalette('search')}
          className={cn(
            'mb-4 flex items-center gap-2.5 rounded-md border border-line bg-sunken',
            'px-3 py-2 text-left text-sm text-text-lo hover:border-line-bright hover:text-text-mid',
          )}
          style={{ boxShadow: 'var(--shadow-sunken)' }}
        >
          <MagnifyingGlass size={16} aria-hidden />
          <span className="flex-1">Search</span>
          <Chord chord={CHORD_FOR.get('palette') ?? 'mod+k'} />
        </button>

        {LISTS.map((item) => (
          <RailLink
            key={item.href}
            item={item}
            active={pathname === item.href}
            count={countFor(item, counts)}
          />
        ))}

        <p className="label mb-1 mt-5 px-3 !text-[0.5625rem]">Tools</p>
        {TOOLS.map((item) => (
          <RailLink
            key={item.href}
            item={item}
            active={pathname === item.href}
            count={countFor(item, counts)}
          />
        ))}

        <div className="mt-auto">
          <RailLink item={SETTINGS} active={pathname === SETTINGS.href} count={0} />
        </div>
      </nav>

      <nav
        aria-label="Views"
        className={cn(
          'safe-bottom safe-x fixed inset-x-0 bottom-0 z-20 flex items-stretch gap-1 md:hidden',
          'border-t border-line bg-surface/95 px-2 py-1.5 backdrop-blur-xl',
        )}
      >
        {BAR_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center gap-0.5 rounded-md px-2 py-1.5',
                active ? 'text-text-hi' : 'text-text-lo',
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active-bar"
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
              <span className="relative text-[0.6875rem]">{item.label}</span>
              {/* No room for a number on the bar, so overdue work shows as a dot
                  rather than being hidden entirely. */}
              {item.count === 'today' && counts.overdue > 0 && (
                <span
                  aria-label={`${counts.overdue} overdue`}
                  className="absolute right-1.5 top-1 size-1.5 rounded-full bg-clay-400"
                />
              )}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          className={cn(
            'relative flex flex-1 flex-col items-center gap-0.5 rounded-md px-2 py-1.5',
            moreActive ? 'text-text-hi' : 'text-text-lo',
          )}
        >
          {moreActive && (
            <motion.span
              layoutId="nav-active-bar"
              aria-hidden
              className="absolute inset-0 rounded-md border border-line-bright bg-raised"
              transition={SOFT}
            />
          )}
          <DotsThree
            size={19}
            weight={moreActive ? 'fill' : 'bold'}
            className={cn('relative', moreActive && 'text-clay-300')}
            aria-hidden
          />
          <span className="relative text-[0.6875rem]">More</span>
        </button>
      </nav>

      <MoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
