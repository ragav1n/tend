import type { Icon } from '@phosphor-icons/react';
import {
  Archive,
  CalendarBlank,
  CalendarDots,
  CheckCircle,
  GearSix,
  Kanban,
  Sun,
  Tray,
} from '@phosphor-icons/react/dist/ssr';

/**
 * Every destination in the app, in one list.
 *
 * The rail and the bottom bar read the same array, because two hand-maintained
 * lists of the same destinations drift the week a view is added. They show
 * different subsets: the rail has room for all of it, the bar has room for four
 * plus More, so `bar` marks which ones a phone shows without a tap.
 */

export type CountKey = 'today' | 'upcoming' | 'inbox';

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  /** Which sidebar badge to show, when there is one. */
  count?: CountKey;
  /** On the phone's bottom bar rather than behind More. */
  bar?: boolean;
}

/** What is on the plate. */
export const LISTS: NavItem[] = [
  { href: '/today', label: 'Today', icon: Sun, count: 'today', bar: true },
  { href: '/upcoming', label: 'Upcoming', icon: CalendarDots, count: 'upcoming', bar: true },
  { href: '/inbox', label: 'Inbox', icon: Tray, count: 'inbox', bar: true },
  { href: '/someday', label: 'Someday', icon: Archive },
  { href: '/logbook', label: 'Logbook', icon: CheckCircle },
];

/** Ways of working through it. */
export const TOOLS: NavItem[] = [
  { href: '/calendar', label: 'Calendar', icon: CalendarBlank, bar: true },
  { href: '/board', label: 'Board', icon: Kanban },
];

export const SETTINGS: NavItem = { href: '/settings', label: 'Settings', icon: GearSix };

export const ALL_ITEMS: NavItem[] = [...LISTS, ...TOOLS, SETTINGS];

/** What the bottom bar shows before More. */
export const BAR_ITEMS: NavItem[] = ALL_ITEMS.filter((item) => item.bar);

/** What More opens onto: everything the bar had no room for. */
export const MORE_ITEMS: NavItem[] = ALL_ITEMS.filter((item) => !item.bar);
