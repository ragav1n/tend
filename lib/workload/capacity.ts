import type { PlainDate } from '@/lib/db/types';

/**
 * How much room a stretch of days holds.
 *
 * Shared by the load strip and the slack figure so the two cannot disagree about
 * what a week is worth. A weekend contributing nothing is the whole reason a
 * Friday deadline reads as tight rather than as three days away.
 */

export interface Capacity {
  /** Minutes of real work in a work day. */
  dailyMinutes: number;
  /** ISO weekdays that carry capacity, 1 Monday through 7 Sunday. */
  workDays: readonly number[];
}

/**
 * ISO weekday for a `YYYY-MM-DD`, 1 Monday through 7 Sunday.
 *
 * Parsed as UTC and read as UTC. A wall-clock date has no zone, and letting the
 * device's offset decide would make a Sunday in Auckland a Saturday in Atlanta
 * and shift somebody's whole week.
 */
export function isoDayOf(date: PlainDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  // getUTCDay is 0 for Sunday; ISO calls it 7.
  return day === 0 ? 7 : day;
}

/** `2026-09-21` plus n days, staying a wall-clock date. */
export function addDays(date: PlainDate, days: number): PlainDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function daysBetween(from: PlainDate, to: PlainDate): PlainDate[] {
  const out: PlainDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** What one day holds. Zero on a day you do not work. */
export function capacityOf(date: PlainDate, capacity: Capacity): number {
  return capacity.workDays.includes(isoDayOf(date)) ? capacity.dailyMinutes : 0;
}

/**
 * What the days from `from` to `to` hold together, inclusive.
 *
 * Zero when `to` is before `from`, which is the overdue case: a deadline that
 * has passed has no room left before it, and that is what makes its slack come
 * out negative rather than merely small.
 */
export function capacityBetween(from: PlainDate, to: PlainDate, capacity: Capacity): number {
  let total = 0;
  for (const day of daysBetween(from, to)) total += capacityOf(day, capacity);
  return total;
}

/**
 * Minutes as hours and minutes.
 *
 * Separate from `formatMinutes` in `lib/focus/timer.ts`, which takes *seconds*
 * despite the name, because the focus timer counts in seconds. Reusing it here
 * rendered a four hour day as "4m".
 */
export function formatWorkMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole}m`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
