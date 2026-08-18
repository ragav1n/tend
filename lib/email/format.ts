/**
 * Dates and times for email, formatted without a timezone in sight.
 *
 * Everything arriving here is already wall clock in the reader's zone, because
 * Postgres did that conversion when it generated the delivery row. Formatting it
 * with `Intl` and a timezone would convert it a second time, which is the bug
 * this file exists to avoid.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '2026-09-01' becomes 'Tue 1 Sep'. */
export function formatDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return `${DAYS[parsed.getUTCDay()]} ${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]}`;
}

/** '18:00:00' becomes '6:00 pm'. Lower case, because a subject line is a sentence. */
export function formatTime(time: string): string {
  const [rawHour, rawMinute] = time.split(':');
  const hour = Number(rawHour);
  const minute = rawMinute ?? '00';
  if (Number.isNaN(hour)) return time;
  const suffix = hour < 12 ? 'am' : 'pm';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${minute} ${suffix}`;
}

/** 'Tue 1 Sep at 6:00 pm', or just the day for an all-day task. */
export function formatWhen(day: string | null, time: string | null): string {
  if (!day) return time ? formatTime(time) : '';
  return time ? `${formatDay(day)} at ${formatTime(time)}` : formatDay(day);
}

/** 'today', 'tomorrow', 'yesterday' or the date, read against the reader's day. */
export function formatRelativeDay(day: string, localDate: string): string {
  const target = new Date(`${day}T00:00:00Z`).getTime();
  const base = new Date(`${localDate}T00:00:00Z`).getTime();
  const days = Math.round((target - base) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < -1) return `${Math.abs(days)} days ago`;
  return formatDay(day);
}

/** '3 tasks', '1 task'. Pluralisation in one place so no subject line gets it wrong. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
