import type { PlainDate, PlainTime } from '@/lib/db/types';

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
