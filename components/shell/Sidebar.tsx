'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { CaretRight, DotsThree, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { APP_NAME } from '@/lib/config';
import { MarkTile } from '@/components/brand/Mark';
import { MoreMenu } from '@/components/shell/MoreMenu';
import {
  BAR_ITEMS,
  itemsIn,
  MORE_ITEMS,
  RAIL_SECTIONS,
  SECTION_LABEL,
  SETTINGS,
  type NavItem,
} from '@/components/shell/nav';
import { CHORD_FOR } from '@/components/shell/keymap';
import { Chord } from '@/components/ui/Kbd';
import { SOFT } from '@/lib/motion';
import { useSidebarCounts } from '@/hooks/use-tasks';
import { useSavedViews } from '@/hooks/use-views';
import { viewIcon } from '@/components/views/viewIcons';
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

/**
 * The saved views pinned to the rail.
 *
 * Its own component behind a Suspense boundary because it reads
 * `useSearchParams`: a saved view is a query string on one route, so knowing
 * which one is open needs the search. Read from the Sidebar itself that call
 * opts every page in the app out of prerendering, which the service worker
 * precache depends on.
 */
function PinnedViews({ pathname }: { pathname: string }) {
  const views = useSavedViews().filter((view) => view.pinned);
  const search = useSearchParams().toString();
  if (views.length === 0) return null;

  const here = search ? `${pathname}?${search}` : pathname;

  return (
    <>
      <p className="label mb-1 mt-5 px-3 !text-[0.5625rem]">Views</p>
      {views.map((view) => (
        <RailLink
          key={view.id}
          item={{
            href: `/views?v=${view.id}`,
            label: view.name,
            icon: viewIcon(view.icon),
            section: 'plan',
          }}
          active={`/views?v=${view.id}` === here}
          count={0}
        />
      ))}
    </>
  );
}

/**
 * The four destinations the rail keeps folded away.
 *
 * A disclosure rather than a second More sheet: the rail has the room, and a
 * sheet on a desktop to reach Tags is a click and a dismissal to do what a
 * click should. It opens itself when one of its pages is showing, so the rail
 * never claims you are nowhere.
 */
function RailMore({
  open,
  onToggle,
  pathname,
  counts,
}: {
  open: boolean;
  onToggle: () => void;
  pathname: string;
  counts: ReturnType<typeof useSidebarCounts>;
}) {
  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="label flex w-full items-center gap-1 px-3 !text-[0.5625rem] hover:text-text-mid"
      >
        <CaretRight
          size={9}
          weight="bold"
          aria-hidden
          className={cn('transition-transform duration-150', open && 'rotate-90')}
        />
        More
      </button>

      {open &&
        itemsIn('more').map((item) => (
          <RailLink
            key={item.href}
            item={item}
            active={pathname === item.href}
            count={countFor(item, counts)}
          />
        ))}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const counts = useSidebarCounts();
  const openPalette = useUiStore((state) => state.openPalette);
  const [moreOpen, setMoreOpen] = useState(false);
  const [railMoreOpen, setRailMoreOpen] = useState(false);
  const moreActive = MORE_ITEMS.some((item) => item.href === pathname);
  const railMoreActive = itemsIn('more').some((item) => item.href === pathname);

  return (
    <>
      <nav
        aria-label="Views"
        className={cn(
          'hidden md:fixed md:inset-y-0 md:left-0 md:z-20 md:flex md:w-[232px]',
          'md:flex-col md:border-r md:border-line md:bg-void/60 md:px-3',
          'md:pt-[calc(1.25rem+env(safe-area-inset-top))]',
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

        {RAIL_SECTIONS.map((section, index) => (
          <div key={section}>
            <p className={cn('label mb-1 px-3 !text-[0.5625rem]', index > 0 && 'mt-5')}>
              {SECTION_LABEL[section]}
            </p>
            {itemsIn(section).map((item) => (
              <RailLink
                key={item.href}
                item={item}
                active={pathname === item.href}
                count={countFor(item, counts)}
              />
            ))}
            {/* Pinned views sit under Plan, which is where a saved filter is
                used from. */}
            {section === 'plan' && (
              <Suspense fallback={null}>
                <PinnedViews pathname={pathname} />
              </Suspense>
            )}
          </div>
        ))}

        {/* The long tail, folded. Opened whenever one of its own pages is the
            page you are on, so arriving by shortcut or palette never leaves the
            rail disagreeing with the screen. */}
        <RailMore
          open={railMoreOpen || railMoreActive}
          onToggle={() => setRailMoreOpen((shown) => !shown)}
          pathname={pathname}
          counts={counts}
        />

        <div className="mt-auto">
          <RailLink item={SETTINGS} active={pathname === SETTINGS.href} count={0} />
        </div>
      </nav>

      <nav
        aria-label="Views"
        className={cn(
          'fixed inset-x-0 bottom-0 z-20 flex items-stretch gap-1 md:hidden',
          'border-t border-line bg-surface/95 backdrop-blur-xl',
          // Clears the home indicator. Folded into the padding for the same
          // reason MainFrame's is: `py-1.5` beat `safe-bottom` outright.
          'pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]',
          'pl-[calc(0.5rem+env(safe-area-inset-left))] pr-[calc(0.5rem+env(safe-area-inset-right))]',
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
