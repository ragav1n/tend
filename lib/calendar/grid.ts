import type { PlainDate } from '@/lib/db/types';

/**
 * The month grid, as pure data.
 *
 * Every date here is a wall-clock calendar date, so the arithmetic runs in UTC
 * for the same reason `queries.addDays` does: a local-zone `Date` shifts by an
 * hour across a DST boundary, and adding a day to the wrong side of that
 * boundary silently repeats or skips a date.
 *
 * The grid is always six rows. Five would fit some months, and a grid that
 * changes height as you page through the year makes the whole view jump under
 * the pointer that is paging it.
 */

/** `YYYY-MM`. */
export type Month = string;

export const WEEKS_IN_GRID = 6;
export const DAYS_IN_WEEK = 7;

export interface CalendarDay {
  date: PlainDate;
  /** Day of month, for the label. */
  day: number;
  /** False for the leading and trailing days borrowed from the neighbours. */
  inMonth: boolean;
}

function utc(date: PlainDate): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(date: Date): PlainDate {
  return date.toISOString().slice(0, 10);
}

/** ISO day of week, 1 Monday through 7 Sunday. */
export function isoDayOfWeek(date: PlainDate): number {
  return ((utc(date).getUTCDay() + 6) % 7) + 1;
}

export function shiftDays(date: PlainDate, days: number): PlainDate {
  const next = utc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return iso(next);
}

/** The month a date falls in. */
export function monthOf(date: PlainDate): Month {
  return date.slice(0, 7);
}

/** Steps whole months, so 2026-01-31 plus a month is 2026-02, not March 3rd. */
export function shiftMonth(month: Month, delta: number): Month {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  return `${String(year).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function firstOfMonth(month: Month): PlainDate {
  return `${month}-01`;
}

/**
 * The first cell of the grid: the `weekStart` weekday on or before the 1st.
 * `weekStart` is an ISO weekday, which is what `prefs.weekStart` stores.
 */
export function gridStart(month: Month, weekStart: number): PlainDate {
  const first = firstOfMonth(month);
  const offset = (isoDayOfWeek(first) - weekStart + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  return shiftDays(first, -offset);
}

/** Inclusive bounds of everything the grid shows, which is what the query needs. */
export function gridRange(month: Month, weekStart: number): { from: PlainDate; to: PlainDate } {
  const from = gridStart(month, weekStart);
  return { from, to: shiftDays(from, WEEKS_IN_GRID * DAYS_IN_WEEK - 1) };
}

/**
 * The ISO weekday a grid column holds, 1 Monday through 7 Sunday.
 *
 * What lets a cell know whether the day carries capacity, which is the one
 * honest reason to draw a day back: `prefs.workDays` holds ISO days, and a
 * hardcoded Saturday and Sunday would be wrong for anybody who works them.
 *
 * A `weekStart` of 0 has always meant Sunday to `gridStart`, so it means Sunday
 * here rather than a weekday that does not exist.
 */
export function columnIsoDay(weekStart: number, column: number): number {
  const first = ((weekStart + 6) % DAYS_IN_WEEK) + 1;
  return ((first - 1 + column) % DAYS_IN_WEEK) + 1;
}

/** Six weeks of seven days, ready to render row by row. */
export function monthGrid(month: Month, weekStart: number): CalendarDay[][] {
  const start = gridStart(month, weekStart);
  const weeks: CalendarDay[][] = [];

  for (let w = 0; w < WEEKS_IN_GRID; w += 1) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < DAYS_IN_WEEK; d += 1) {
      const date = shiftDays(start, w * DAYS_IN_WEEK + d);
      week.push({ date, day: Number(date.slice(8)), inMonth: monthOf(date) === month });
    }
    weeks.push(week);
  }

  return weeks;
}

/**
 * Column headings in the user's locale, rotated to `weekStart`.
 *
 * Formatted from a known week in UTC rather than from today, so the labels do
 * not change depending on which day the month is opened.
 */
export function weekdayLabels(weekStart: number, locale?: string): string[] {
  // 2026-01-05 is a Monday, which makes the offset arithmetic ISO-native.
  const monday = '2026-01-05';
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: DAYS_IN_WEEK }, (_, i) =>
    format.format(utc(shiftDays(monday, (weekStart - 1 + i) % DAYS_IN_WEEK))),
  );
}

export function monthLabel(month: Month, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    utc(firstOfMonth(month)),
  );
}

/** Groups rows by a date field, keeping the order they arrived in. */
export function groupByDate<T>(rows: readonly T[], dateOf: (row: T) => PlainDate): Map<PlainDate, T[]> {
  const out = new Map<PlainDate, T[]>();
  for (const row of rows) {
    const key = dateOf(row);
    const bucket = out.get(key);
    if (bucket) bucket.push(row);
    else out.set(key, [row]);
  }
  return out;
}
