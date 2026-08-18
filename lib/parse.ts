import { addDays, isoDow, type IsoDow } from './recurrence';
import type { PlainDate, PlainTime, Priority } from './db/types';

/**
 * Natural language quick add.
 *
 * "Pay the rent tomorrow 9am !p1 #bills @home" becomes a task with a due date, a
 * time, a priority, a tag and a project, and a title of "Pay the rent".
 *
 * Hand-rolled rather than chrono-node, for two reasons. Bundle: chrono is around
 * 50kb gzipped in an app whose whole point is a fast cold start. Control: the
 * parser has to report the exact character range of every token it consumed so
 * the input can highlight them live, and so the title is left with nothing but
 * the actual title. A general-purpose date parser gives neither.
 *
 * Everything here is pure and calendar-only, so it inherits the same DST safety
 * as recurrence.ts.
 */

export type TokenKind = 'date' | 'time' | 'priority' | 'tag' | 'project';

export interface ParsedToken {
  kind: TokenKind;
  /** The matched text, for highlighting. */
  text: string;
  start: number;
  end: number;
}

export interface ParsedTask {
  title: string;
  dueDate: PlainDate | null;
  dueTime: PlainTime | null;
  priority: Priority;
  tagNames: string[];
  projectName: string | null;
  tokens: ParsedToken[];
}

const DOW_NAMES: Record<string, IsoDow> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function localToday(now: Date): PlainDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The next date falling on `dow`.
 *
 * "next friday" always means the following week even when today is Wednesday,
 * because someone typing "next" has already accounted for this week. Bare
 * "friday" means the soonest upcoming Friday, and never today, since a task you
 * are typing now is not something you scheduled for a day already underway.
 */
function nextDow(from: PlainDate, dow: IsoDow, forceNextWeek: boolean): PlainDate {
  const current = isoDow(from);
  let delta = (dow - current + 7) % 7;
  if (delta === 0) delta = 7;
  if (forceNextWeek && delta < 7) delta += 7;
  return addDays(from, delta);
}

/** Resolves a month and day to the next such date, rolling into next year. */
function monthDay(from: PlainDate, month: number, day: number): PlainDate {
  const year = Number(from.slice(0, 4));
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (candidate >= from) return candidate;
  return `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function to24h(hour: number, minute: number, meridiem: string | undefined): PlainTime {
  let h = hour;
  if (meridiem === 'pm' && h < 12) h += 12;
  if (meridiem === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

interface Rule {
  re: RegExp;
  kind: TokenKind;
  apply: (m: RegExpExecArray, ctx: { today: PlainDate; out: ParsedTask }) => boolean;
}

/**
 * Order matters. Longer and more specific patterns run first so "next monday"
 * is not eaten by the bare weekday rule, and "sept 20" is not split by the
 * month rule matching only "sept".
 */
const RULES: Rule[] = [
  // ── Priority ───────────────────────────────────────────────────────────────
  {
    re: /(?:^|\s)(!p?([1-3])|!{1,3})(?=\s|$)/gi,
    kind: 'priority',
    apply: (m, { out }) => {
      const digit = m[2];
      if (digit) {
        // !p1 is highest, matching every other task app.
        out.priority = (4 - Number(digit)) as Priority;
      } else {
        const bangs = (m[1] ?? '').length;
        out.priority = Math.min(3, bangs) as Priority;
      }
      return true;
    },
  },

  // ── Tags and projects ──────────────────────────────────────────────────────
  {
    re: /(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu,
    kind: 'tag',
    apply: (m, { out }) => {
      const name = m[1]!;
      if (!out.tagNames.some((t) => t.toLowerCase() === name.toLowerCase())) {
        out.tagNames.push(name);
      }
      return true;
    },
  },
  {
    re: /(?:^|\s)@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu,
    kind: 'project',
    apply: (m, { out }) => {
      // First one wins. A task belongs to one project.
      if (out.projectName === null) out.projectName = m[1]!;
      return true;
    },
  },

  // ── Relative dates ─────────────────────────────────────────────────────────
  {
    re: /(?:^|\s)(today|tod)(?=\s|$)/gi,
    kind: 'date',
    apply: (_m, { today, out }) => {
      out.dueDate = today;
      return true;
    },
  },
  {
    re: /(?:^|\s)(tomorrow|tmrw?|tmr)(?=\s|$)/gi,
    kind: 'date',
    apply: (_m, { today, out }) => {
      out.dueDate = addDays(today, 1);
      return true;
    },
  },
  {
    re: /(?:^|\s)in\s+(\d{1,3})\s+(day|days|week|weeks|month|months)(?=\s|$)/gi,
    kind: 'date',
    apply: (m, { today, out }) => {
      const n = Number(m[1]);
      const unit = m[2]!.toLowerCase();
      const days = unit.startsWith('week') ? n * 7 : unit.startsWith('month') ? n * 30 : n;
      out.dueDate = addDays(today, days);
      return true;
    },
  },
  {
    re: /(?:^|\s)next\s+week(?=\s|$)/gi,
    kind: 'date',
    apply: (_m, { today, out }) => {
      // The Monday of next week, which is what people mean by "next week".
      out.dueDate = nextDow(today, 1, false);
      return true;
    },
  },
  {
    re: /(?:^|\s)(?:(next)\s+)?(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)(?=\s|$)/gi,
    kind: 'date',
    apply: (m, { today, out }) => {
      const dow = DOW_NAMES[m[2]!.toLowerCase()];
      if (dow === undefined) return false;
      out.dueDate = nextDow(today, dow, m[1] !== undefined);
      return true;
    },
  },

  // ── Absolute dates ─────────────────────────────────────────────────────────
  {
    re: /(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?=\s|$)/g,
    kind: 'date',
    apply: (m, { out }) => {
      out.dueDate = `${m[1]}-${m[2]}-${m[3]}`;
      return true;
    },
  },
  {
    re: /(?:^|\s)(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?=\s|$)/gi,
    kind: 'date',
    apply: (m, { today, out }) => {
      const month = MONTHS[m[1]!.toLowerCase()];
      const day = Number(m[2]);
      if (month === undefined || day < 1 || day > 31) return false;
      out.dueDate = monthDay(today, month, day);
      return true;
    },
  },
  {
    re: /(?:^|\s)(\d{1,2})(?:st|nd|rd|th)?\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)(?=\s|$)/gi,
    kind: 'date',
    apply: (m, { today, out }) => {
      const day = Number(m[1]);
      const month = MONTHS[m[2]!.toLowerCase()];
      if (month === undefined || day < 1 || day > 31) return false;
      out.dueDate = monthDay(today, month, day);
      return true;
    },
  },

  // ── Times ──────────────────────────────────────────────────────────────────
  {
    re: /(?:^|\s)(?:at\s+)?(noon|midday|midnight)(?=\s|$)/gi,
    kind: 'time',
    apply: (m, { out }) => {
      out.dueTime = m[1]!.toLowerCase() === 'midnight' ? '00:00' : '12:00';
      return true;
    },
  },
  {
    re: /(?:^|\s)(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?(?=\s|$)/gi,
    kind: 'time',
    apply: (m, { out }) => {
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h > 23 || min > 59) return false;
      out.dueTime = to24h(h, min, m[3]?.toLowerCase());
      return true;
    },
  },
  {
    re: /(?:^|\s)(?:at\s+)?(\d{1,2})\s*(am|pm)(?=\s|$)/gi,
    kind: 'time',
    apply: (m, { out }) => {
      const h = Number(m[1]);
      if (h > 12) return false;
      out.dueTime = to24h(h, 0, m[2]!.toLowerCase());
      return true;
    },
  },
];

/** True when [start, end) overlaps anything already consumed. */
function overlaps(claimed: Array<[number, number]>, start: number, end: number): boolean {
  return claimed.some(([s, e]) => start < e && end > s);
}

export function parseQuickAdd(input: string, now = new Date()): ParsedTask {
  const today = localToday(now);
  const out: ParsedTask = {
    title: '',
    dueDate: null,
    dueTime: null,
    priority: 0,
    tagNames: [],
    projectName: null,
    tokens: [],
  };

  const claimed: Array<[number, number]> = [];

  for (const rule of RULES) {
    // Each rule gets a fresh regex so lastIndex from a previous parse cannot
    // leak between calls.
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      // The leading (?:^|\s) is part of the match, so shift past it to keep the
      // highlight on the token itself rather than the space before it.
      const lead = /^\s/.test(m[0]) ? 1 : 0;
      const start = m.index + lead;
      const end = m.index + m[0].length;

      if (overlaps(claimed, start, end)) continue;
      // Only the first match of each kind wins for the single-value fields, so
      // "tomorrow friday" takes tomorrow and leaves "friday" in the title.
      if (rule.kind === 'date' && out.dueDate !== null) continue;
      if (rule.kind === 'time' && out.dueTime !== null) continue;
      if (rule.kind === 'priority' && out.priority !== 0) continue;

      if (!rule.apply(m, { today, out })) continue;

      claimed.push([start, end]);
      out.tokens.push({ kind: rule.kind, text: input.slice(start, end), start, end });
    }
  }

  // The title is whatever nobody claimed.
  claimed.sort((a, b) => a[0] - b[0]);
  let title = '';
  let cursor = 0;
  for (const [s, e] of claimed) {
    title += input.slice(cursor, s);
    cursor = e;
  }
  title += input.slice(cursor);

  out.title = title.replace(/\s+/g, ' ').trim();
  out.tokens.sort((a, b) => a.start - b.start);

  // A time with no date means today, which is the only reading that makes sense
  // for "call mum at 6pm".
  if (out.dueTime !== null && out.dueDate === null) out.dueDate = today;

  return out;
}
