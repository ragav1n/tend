import type { Icon } from '@phosphor-icons/react';
import {
  Archive,
  CalendarBlank,
  CalendarDots,
  ChartLineUp,
  CheckCircle,
  FolderSimple,
  GearSix,
  GraduationCap,
  Hash,
  Kanban,
  Funnel,
  Sun,
  Timer,
  Tray,
} from '@phosphor-icons/react/dist/ssr';

/**
 * Every destination in the app, in one list.
 *
 * The rail and the bottom bar read the same array, because two hand-maintained
 * lists of the same destinations drift the week a view is added. They show
 * different subsets: the bar has room for four plus More, so `bar` marks which
 * ones a phone shows without a tap.
 *
 * The rail used to show all of them flat. Adding Courses would have made
 * fourteen, which is a wall rather than a menu, so they are grouped by what you
 * are doing and the four least-visited sit behind a disclosure. Nine visible
 * instead of thirteen.
 *
 * Every `g` letter keeps the meaning it already had. `g o` for Courses is the
 * only new one, so nothing has to be relearned, and the palette lists every
 * destination anyway, which is what lets the rail afford to collapse four.
 */

export type CountKey = 'today' | 'upcoming' | 'inbox';

/** Which group of the rail an item sits in. */
export type NavSection = 'plan' | 'work' | 'back' | 'more';

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  section: NavSection;
  /** Which sidebar badge to show, when there is one. */
  count?: CountKey;
  /** On the phone's bottom bar rather than behind More. */
  bar?: boolean;
  /** The letter that follows `g` to come here. Owned by this list for the same
   *  reason `href` is: a second list of the same shortcuts would drift. */
  key?: string;
}

/**
 * The destinations, in rail order.
 *
 * Plan is what you are doing now, Work is where it is filed, Back is what
 * already happened. More is everything that answers a question you ask
 * occasionally: a tag, a saved filter, a board, a timer.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/today', label: 'Today', icon: Sun, section: 'plan', count: 'today', bar: true, key: 't' },
  { href: '/upcoming', label: 'Upcoming', icon: CalendarDots, section: 'plan', count: 'upcoming', bar: true, key: 'u' },
  { href: '/calendar', label: 'Calendar', icon: CalendarBlank, section: 'plan', key: 'c' },

  { href: '/inbox', label: 'Inbox', icon: Tray, section: 'work', count: 'inbox', bar: true, key: 'i' },
  { href: '/courses', label: 'Courses', icon: GraduationCap, section: 'work', bar: true, key: 'o' },
  { href: '/projects', label: 'Projects', icon: FolderSimple, section: 'work', key: 'p' },
  { href: '/someday', label: 'Someday', icon: Archive, section: 'work', key: 's' },

  { href: '/logbook', label: 'Logbook', icon: CheckCircle, section: 'back', key: 'l' },
  { href: '/review', label: 'Review', icon: ChartLineUp, section: 'back', key: 'r' },

  { href: '/tags', label: 'Tags', icon: Hash, section: 'more', key: 'h' },
  { href: '/views', label: 'Views', icon: Funnel, section: 'more', key: 'v' },
  { href: '/board', label: 'Board', icon: Kanban, section: 'more', key: 'b' },
  { href: '/focus', label: 'Focus', icon: Timer, section: 'more', key: 'f' },
];

export const SETTINGS: NavItem = {
  href: '/settings',
  label: 'Settings',
  icon: GearSix,
  section: 'more',
  key: ',',
};

export const ALL_ITEMS: NavItem[] = [...NAV_ITEMS, SETTINGS];

/** The heading over each rail group. `more` draws its own disclosure instead. */
export const SECTION_LABEL: Record<Exclude<NavSection, 'more'>, string> = {
  plan: 'Plan',
  work: 'Work',
  back: 'Looking back',
};

export const RAIL_SECTIONS: Exclude<NavSection, 'more'>[] = ['plan', 'work', 'back'];

export function itemsIn(section: NavSection): NavItem[] {
  return NAV_ITEMS.filter((item) => item.section === section);
}

/**
 * What the bottom bar shows before More.
 *
 * Calendar came off it when Courses went on. A month grid on a 393px screen
 * already degrades to dots rather than titles, so it is the one of the five that
 * loses least by being a tap further away.
 */
export const BAR_ITEMS: NavItem[] = ALL_ITEMS.filter((item) => item.bar);

/** What More opens onto: everything the bar had no room for. */
export const MORE_ITEMS: NavItem[] = ALL_ITEMS.filter((item) => !item.bar);
