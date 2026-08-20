import { APP_NAME } from '@/lib/config';
import type { RecurrenceRule } from '@/lib/recurrence';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';

/**
 * Tasks as an RFC 5545 calendar.
 *
 * VEVENT, not VTODO. Every calendar reads VEVENT; VTODO support is patchy
 * enough that Google Calendar drops it silently, and a file that imports into
 * nothing is not an export. The trade is that a task becomes a dated entry
 * rather than a checkbox, which is what somebody asking to see their deadlines
 * in a calendar wanted anyway.
 *
 * Dates go out as `VALUE=DATE`, floating, with no VTIMEZONE. That is the exact
 * meaning tasks already carry: due "tomorrow 9am" is 9am wherever you stand,
 * and stamping a zone here would silently reschedule everything on the flight.
 *
 * Only `DTSTAMP` and `CREATED` are absolute, because they describe when the
 * file was written and when the row was, which are real instants.
 */

/** Text escaping, per RFC 5545 section 3.3.11. The backslash goes first, or it
 *  escapes the escapes added after it. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Content lines wrap at 75 octets, continued with a leading space.
 *
 * Counted in octets rather than characters, because the limit is bytes and a
 * task title with an emoji in it would otherwise produce a line the spec calls
 * too long. The split never lands inside a multi-byte character.
 */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  let width = 0;
  let limit = 75;

  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (width + size > limit) {
      out.push(line.slice(start, start + countChars(line, start, width)));
      start += countChars(line, start, width);
      width = 0;
      // A continuation line spends one of its 75 octets on the leading space.
      limit = 74;
    }
    width += size;
  }
  out.push(line.slice(start));
  return out.join('\r\n ');
}

/** How many characters of `line` from `start` make up `bytes` octets. */
function countChars(line: string, start: number, bytes: number): number {
  const encoder = new TextEncoder();
  let used = 0;
  let chars = 0;
  for (const char of line.slice(start)) {
    const size = encoder.encode(char).length;
    if (used + size > bytes) break;
    used += size;
    chars += char.length;
  }
  return chars;
}

/** `2026-08-20` to `20260820`. */
export function toIcsDate(day: string): string {
  return day.replace(/-/g, '');
}

/** An instant to `20260820T091500Z`. */
export function toIcsStamp(instant: string): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** The day after, so an all-day VEVENT covers exactly one day: DTEND is
 *  exclusive, and a DTEND equal to DTSTART renders as a zero-length event. */
export function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const FREQ: Record<RecurrenceRule['freq'], string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};

const DOW = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * The structured rule as an RRULE, or null when it cannot be one.
 *
 * `timed` says whether the event's DTSTART carries a time, because UNTIL has to
 * match it.
 *
 * `completion_date` anchoring has no RRULE. RFC 5545 describes a fixed calendar
 * series, and "every 3 days after I finish it" is not one: that is the whole
 * reason this app stores structured columns instead of RRULE strings. Rather
 * than emit a rule that means something else, those series export as their one
 * open occurrence and the description says so.
 */
export function toRrule(rule: RecurrenceRule, timed = false): string | null {
  if (rule.anchorMode === 'completion_date') return null;

  const parts = [`FREQ=${FREQ[rule.freq]}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${Math.trunc(rule.interval)}`);

  if (rule.byday && rule.byday.length > 0) {
    // A monthWeek prefix turns a weekday list into "the 3rd Tuesday".
    const prefix = rule.monthWeek ? String(rule.monthWeek) : '';
    parts.push(`BYDAY=${rule.byday.map((d) => `${prefix}${DOW[d]}`).join(',')}`);
  }
  if (rule.bymonthday && rule.bymonthday.length > 0) {
    parts.push(`BYMONTHDAY=${rule.bymonthday.join(',')}`);
  }
  if (rule.bymonth && rule.bymonth.length > 0) {
    parts.push(`BYMONTH=${rule.bymonth.join(',')}`);
  }

  if (rule.endsMode === 'on_date' && rule.endsOn) {
    // RFC 5545 3.3.10: UNTIL has to be the same value type as DTSTART. A DATE
    // form against a DATE-TIME start makes strict parsers drop the rule, and
    // Google Calendar imports the series as never-ending instead.
    parts.push(`UNTIL=${toIcsDate(rule.endsOn)}${timed ? 'T235959' : ''}`);
  }
  if (rule.endsMode === 'after_count' && rule.endsAfterCount) {
    parts.push(`COUNT=${rule.endsAfterCount}`);
  }

  return parts.join(';');
}

export interface IcsTask {
  task: Task;
  /** The series rule, when the task repeats on a fixed calendar. */
  rule?: RecurrenceRule;
  /** Names of the projects and tags, for the description. */
  project?: string;
  tags?: string[];
}

const PRIORITY_LABEL: Record<number, string> = { 1: 'P3', 2: 'P2', 3: 'P1' };

function description(entry: IcsTask): string {
  const lines: string[] = [];
  if (entry.project) lines.push(`Project: ${entry.project}`);
  if (entry.tags && entry.tags.length > 0) lines.push(`Tags: ${entry.tags.join(', ')}`);
  if (entry.task.priority > 0) lines.push(`Priority: ${PRIORITY_LABEL[entry.task.priority]}`);
  if (entry.task.estimateMinutes) lines.push(`Estimate: ${entry.task.estimateMinutes} min`);
  if (entry.task.notes.trim()) lines.push('', entry.task.notes.trim());
  return lines.join('\n');
}

function event(entry: IcsTask, stamp: string, domain: string): string[] {
  const { task } = entry;
  const lines = [
    'BEGIN:VEVENT',
    // Stable across exports, so re-importing updates the entry a calendar
    // already has instead of adding a second copy of every task.
    `UID:${task.id}@${domain}`,
    `DTSTAMP:${stamp}`,
    `CREATED:${toIcsStamp(task.createdAt)}`,
  ];

  if (task.dueTime) {
    // Floating local time: no Z, no TZID. Same reason the dates are floating.
    const start = `${toIcsDate(task._dueDay)}T${task.dueTime.replace(':', '')}00`;
    lines.push(`DTSTART:${start}`, `DURATION:PT${task.estimateMinutes ?? 30}M`);
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${toIcsDate(task._dueDay)}`,
      // Exclusive, so an all-day entry covers exactly the due day.
      `DTEND;VALUE=DATE:${toIcsDate(nextDay(task._dueDay))}`,
    );
  }

  lines.push(`SUMMARY:${escapeText(task.title)}`);

  const body = description(entry);
  if (body) lines.push(`DESCRIPTION:${escapeText(body)}`);

  const rrule = entry.rule ? toRrule(entry.rule, Boolean(task.dueTime)) : null;
  if (rrule) lines.push(`RRULE:${rrule}`);

  // Done work exports as confirmed history rather than as a commitment.
  lines.push(`STATUS:${task._done === 1 ? 'CONFIRMED' : 'TENTATIVE'}`);
  if (task.priority > 0) lines.push(`PRIORITY:${9 - task.priority * 2}`);

  lines.push('END:VEVENT');
  return lines;
}

/** Tasks worth putting in a calendar: the ones with a date and no tombstone. */
export function exportable(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task._del === 0 && task._dueDay !== NO_DUE_DAY);
}

export interface IcsOptions {
  /** When the file was written. Passed in so a test can assert the whole body. */
  now?: Date;
  /** The right-hand side of every UID. */
  domain?: string;
  calendarName?: string;
}

export function toIcs(entries: readonly IcsTask[], options: IcsOptions = {}): string {
  const stamp = toIcsStamp((options.now ?? new Date()).toISOString());
  const domain = options.domain ?? 'tend.app';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${APP_NAME}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName ?? APP_NAME)}`,
    ...entries.flatMap((entry) => event(entry, stamp, domain)),
    'END:VCALENDAR',
  ];

  // CRLF, and a trailing one: the spec says every content line ends with it,
  // including the last, and a few parsers drop the final line without it.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function icsFilename(now = new Date()): string {
  return `tend-${now.toISOString().slice(0, 10)}.ics`;
}
