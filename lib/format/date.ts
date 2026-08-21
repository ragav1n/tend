import type { Instant, PlainDate, PlainTime } from '@/lib/db/types';

/**
 * How a date reads in a list.
 *
 * Relative inside a week because "Thursday" is what someone plans around, and
 * absolute past that because "in 23 days" is not. Everything is computed in UTC
 * from the plain date: these are wall-clock dates, and constructing them in the
 * local zone shifts the difference by a day either side of a DST boundary.
 */
export function formatDueLabel(due: PlainDate, todayDate: PlainDate, locale?: string): string {
  if (due === todayDate) return 'Today';

  const [y, m, d] = due.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d);
  const [ty, tm, td] = todayDate.split('-').map(Number) as [number, number, number];
  const diff = Math.round((asUtc - Date.UTC(ty, tm - 1, td)) / 86_400_000);

  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) {
    return new Date(asUtc).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });
  }
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  return new Date(asUtc).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** 24h storage, 12h display, and no ":00" on the hour. */
export function formatClock(time: PlainTime): string {
  const [h, min] = time.split(':').map(Number) as [number, number];
  const meridiem = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return min === 0 ? `${hour}${meridiem}` : `${hour}:${String(min).padStart(2, '0')}${meridiem}`;
}

/**
 * How long ago something happened, for a log rather than for a plan.
 *
 * Relative for a day, then absolute, because "17 hours ago" is still something
 * a person can place and "94 hours ago" is arithmetic. Rounds down: an entry
 * written 119 seconds ago reads "1 min ago", which is true, where rounding up
 * would report a minute that has not finished.
 *
 * `now` defaults the way `today()` does, so a render body reads the clock
 * through a named function rather than constructing a date inline, and a test
 * pins it by passing one.
 */
export function formatSince(at: Instant, now = new Date(), locale?: string): string {
  const then = new Date(at);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  // A clock that disagrees with the server, or a row written a moment ago on
  // another device. Either way "in 3 seconds" is noise.
  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
