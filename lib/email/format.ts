/**
 * Dates and times for email, formatted without a timezone in sight.
 *
 * Everything arriving here is already wall clock in the reader's zone, because
 * Postgres did that conversion when it generated the delivery row. Formatting it
 * with `Intl` and a timezone would convert it a second time, which is the bug
 * this file exists to avoid.
 */

import type { TaskDetail } from './types';

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

/**
 * The small print under a title, in the order it reads best.
 *
 * Every part is optional, so a task with nothing but a title gets an empty array
 * and the template drops the line rather than printing a lonely separator.
 */
export function taskMeta(task: TaskDetail & { project: string | null }): string[] {
  const parts: string[] = [];
  if (task.waiting) parts.push('waiting');
  if (task.project) parts.push(task.project);
  if (task.subtasks && task.subtasks.total > 0) {
    parts.push(`${task.subtasks.done} of ${task.subtasks.total} done`);
  }
  if (task.estimate) parts.push(formatDuration(task.estimate));
  if (task.repeats) parts.push('repeats');
  for (const tag of task.tags ?? []) parts.push(`#${tag}`);
  return parts;
}

/** 45 becomes '45m', 90 becomes '1h 30m', 120 becomes '2h'. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** 'Mon', for a chart axis. Sunday is 0, which is what getUTCDay hands back. */
export function weekdayInitial(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return DAYS[parsed.getUTCDay()]!;
}

/** '3 tasks', '1 task'. Pluralisation in one place so no subject line gets it wrong. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
