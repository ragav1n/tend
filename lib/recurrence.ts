import type { PlainDate } from './db/types';

/**
 * Recurrence, as structured rules rather than RFC 5545 RRULE strings.
 *
 * RRULE lost on three counts. It cannot express "every 3 days after I finish
 * it", because RFC 5545 describes a fixed calendar series and not a
 * completion-relative one, so an RRULE design needs a sidecar anchor flag anyway
 * and the RRULE stops being the source of truth. Postgres cannot read it, since
 * Supabase ships no RRULE evaluator, so the reminder pipeline could not answer
 * "what is the next instance". And rrule.js is roughly 40kb gzipped in a PWA
 * whose whole point is a fast cold start.
 *
 * This module is pure and calendar-only. It never constructs a local-timezone
 * Date, so DST cannot shift a result: "every day at 9am" stays 9am across a
 * transition because 9am is literally what gets stored, and the date arithmetic
 * here only ever touches Y/M/D.
 *
 * The server will import this same file, so the offline client and any
 * server-side generation cannot disagree about what comes next.
 */

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** ISO day of week: 1 Monday through 7 Sunday. */
export type IsoDow = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface RecurrenceRule {
  freq: Freq;
  /** Every N periods. 1 means every period. */
  interval: number;
  /** Weekly, and monthly when paired with monthWeek ("the 3rd Tuesday"). */
  byday?: IsoDow[];
  /** Monthly and yearly. 1 through 31, or -1 for the last day of the month. */
  bymonthday?: number[];
  /** Yearly. 1 through 12. */
  bymonth?: number[];
  /** Monthly. 1 through 5 for "nth", -1 for "last". Needs byday. */
  monthWeek?: number;

  /**
   * 'due_date' computes from the previous scheduled date, so completing Monday's
   * task on Wednesday still yields next Monday and the schedule never drifts.
   * 'completion_date' computes from when you actually finished, which is what
   * "water the plants every 3 days" means.
   */
  anchorMode: 'due_date' | 'completion_date';

  /**
   * Only consulted for 'due_date' anchoring. Completing a weekly task three
   * weeks late leaves the naive next date still in the past.
   * 'skip_to_future' advances past today and counts what it skipped.
   * 'keep_backlog' emits the immediate next occurrence anyway, which is what
   * habit logging wants because it keeps the gap visible.
   */
  catchupPolicy: 'skip_to_future' | 'keep_backlog';

  endsMode: 'never' | 'on_date' | 'after_count';
  endsOn?: PlainDate;
  endsAfterCount?: number;
}

export interface NextOccurrenceInput {
  rule: RecurrenceRule;
  /** Scheduled date of the occurrence that was just completed. */
  occurrenceDate: PlainDate;
  /** The user's local calendar date when they completed it. */
  completedOn: PlainDate;
  /** Today, in the user's local zone. */
  today: PlainDate;
  /** Occurrences already completed in this series, for endsAfterCount. */
  completedCount: number;
}

export type NextOccurrence =
  | { kind: 'next'; date: PlainDate; skipped: number }
  | { kind: 'ended'; reason: 'on_date' | 'after_count' };

// ─── Calendar arithmetic ──────────────────────────────────────────────────────
// Everything below operates on Y/M/D triples. Date is used only in UTC, purely
// as a day-number calculator, so no local timezone or DST rule can reach it.

interface Parts {
  y: number;
  m: number;
  d: number;
}

export function toParts(date: PlainDate): Parts {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

export function fromParts({ y, m, d }: Parts): PlainDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toUtc({ y, m, d }: Parts): number {
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): Parts {
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const DAY_MS = 86_400_000;

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromParts(fromUtc(toUtc(toParts(date)) + days * DAY_MS));
}

export function daysBetween(from: PlainDate, to: PlainDate): number {
  return Math.round((toUtc(toParts(to)) - toUtc(toParts(from))) / DAY_MS);
}

/** ISO day of week, 1 Monday through 7 Sunday. */
export function isoDow(date: PlainDate): IsoDow {
  const js = new Date(toUtc(toParts(date))).getUTCDay(); // 0 Sunday
  return (js === 0 ? 7 : js) as IsoDow;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Shifts a month, clamping the day so 31 January plus one month lands on 28 or 29 February. */
function addMonths({ y, m, d }: Parts, months: number): Parts {
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
}

/** The Monday of the week containing `date`. Anchors interval alignment. */
function weekStart(date: PlainDate): PlainDate {
  return addDays(date, -(isoDow(date) - 1));
}

/**
 * The nth occurrence of a weekday in a month. `week` of -1 means the last one.
 * Returns null when the month has no nth such weekday, for example a 5th Tuesday
 * in a month that only has four.
 */
export function nthWeekdayOfMonth(
  y: number,
  m: number,
  dow: IsoDow,
  week: number,
): PlainDate | null {
  if (week === -1) {
    const last = daysInMonth(y, m);
    for (let d = last; d >= 1; d--) {
      const candidate = fromParts({ y, m, d });
      if (isoDow(candidate) === dow) return candidate;
    }
    return null;
  }

  let seen = 0;
  const last = daysInMonth(y, m);
  for (let d = 1; d <= last; d++) {
    const candidate = fromParts({ y, m, d });
    if (isoDow(candidate) !== dow) continue;
    seen += 1;
    if (seen === week) return candidate;
  }
  return null;
}

/** Resolves a bymonthday entry, where -1 means the last day of that month. */
function resolveMonthDay(y: number, m: number, day: number): PlainDate | null {
  if (day === -1) return fromParts({ y, m, d: daysInMonth(y, m) });
  if (day < 1 || day > daysInMonth(y, m)) return null;
  return fromParts({ y, m, d: day });
}

// ─── The step function ────────────────────────────────────────────────────────

/**
 * The first date strictly after `anchor` that satisfies the rule.
 *
 * Each branch advances by whole periods so a rule stays aligned to its original
 * anchor. Weekly alignment is computed against the Monday of the anchor's week,
 * which is what makes "every other Tuesday" keep landing on the same fortnight
 * rather than sliding by a week each time.
 */
export function stepOnce(rule: RecurrenceRule, anchor: PlainDate): PlainDate | null {
  const interval = Math.max(1, Math.trunc(rule.interval));

  switch (rule.freq) {
    case 'daily':
      return addDays(anchor, interval);

    case 'weekly': {
      const days = [...(rule.byday ?? [isoDow(anchor)])].sort((a, b) => a - b);
      const anchorWeek = weekStart(anchor);

      // Walk forward a bounded number of days. Two full interval periods is
      // always enough to find the next match, and the bound means a malformed
      // rule fails fast instead of spinning.
      const limit = 7 * interval * 2 + 7;
      for (let i = 1; i <= limit; i++) {
        const candidate = addDays(anchor, i);
        if (!days.includes(isoDow(candidate))) continue;
        const weeksApart = daysBetween(anchorWeek, weekStart(candidate)) / 7;
        if (weeksApart % interval === 0) return candidate;
      }
      return null;
    }

    case 'monthly': {
      const a = toParts(anchor);

      if (rule.monthWeek !== undefined && rule.byday && rule.byday.length > 0) {
        const dow = rule.byday[0]!;
        // Skip months that have no nth weekday, rather than giving up: a rule of
        // "5th Friday" is legitimate and simply skips most months.
        for (let step = 1; step <= 24; step++) {
          const shifted = addMonths({ ...a, d: 1 }, interval * step);
          const candidate = nthWeekdayOfMonth(shifted.y, shifted.m, dow, rule.monthWeek);
          if (candidate && candidate > anchor) return candidate;
        }
        return null;
      }

      const wanted = [...(rule.bymonthday ?? [a.d])].sort((x, y) => x - y);
      for (let step = 1; step <= 24; step++) {
        const shifted = addMonths({ ...a, d: 1 }, interval * step);
        const hits = wanted
          .map((day) => resolveMonthDay(shifted.y, shifted.m, day))
          .filter((d): d is PlainDate => d !== null)
          .sort();
        const hit = hits.find((d) => d > anchor);
        if (hit) return hit;
      }
      return null;
    }

    case 'yearly': {
      const a = toParts(anchor);
      const months = [...(rule.bymonth ?? [a.m])].sort((x, y) => x - y);
      const days = rule.bymonthday ?? [a.d];

      for (let step = 1; step <= 8; step++) {
        const y = a.y + interval * step;
        const hits: PlainDate[] = [];
        for (const m of months) {
          for (const day of days) {
            const c = resolveMonthDay(y, m, day);
            if (c) hits.push(c);
          }
        }
        const hit = hits.sort().find((d) => d > anchor);
        if (hit) return hit;
      }
      return null;
    }
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * The date of the occurrence that should be created when one is completed, or a
 * signal that the series has ended.
 *
 * Called by the client the moment a recurring task is checked off, with no
 * network involved, which is what makes recurrence work offline.
 */
export function nextOccurrence(input: NextOccurrenceInput): NextOccurrence {
  const { rule, occurrenceDate, completedOn, today, completedCount } = input;

  // End conditions are checked before generating, so a finished series never
  // materializes one extra row.
  if (rule.endsMode === 'after_count') {
    const cap = rule.endsAfterCount ?? 0;
    if (completedCount + 1 >= cap) return { kind: 'ended', reason: 'after_count' };
  }

  if (rule.anchorMode === 'completion_date') {
    // Relative to when the work actually happened. Completing late pushes the
    // whole series later, which is the point.
    const date = stepOnce(rule, completedOn);
    if (!date) return { kind: 'ended', reason: 'on_date' };
    if (rule.endsMode === 'on_date' && rule.endsOn && date > rule.endsOn) {
      return { kind: 'ended', reason: 'on_date' };
    }
    return { kind: 'next', date, skipped: 0 };
  }

  // Fixed schedule. Advance from the previous scheduled date so the series does
  // not drift when a task is completed late.
  let date = stepOnce(rule, occurrenceDate);
  if (!date) return { kind: 'ended', reason: 'on_date' };

  let skipped = 0;
  if (rule.catchupPolicy === 'skip_to_future') {
    // A bound rather than a while(true): a daily task abandoned for years would
    // otherwise loop thousands of times on the frame the user tapped.
    const MAX_CATCHUP_STEPS = 5000;
    while (date <= today && skipped < MAX_CATCHUP_STEPS) {
      const advanced = stepOnce(rule, date);
      if (!advanced) break;
      date = advanced;
      skipped += 1;
    }
  }

  if (rule.endsMode === 'on_date' && rule.endsOn && date > rule.endsOn) {
    return { kind: 'ended', reason: 'on_date' };
  }

  return { kind: 'next', date, skipped };
}

/** Human-readable summary for the task detail panel. */
export function describeRule(rule: RecurrenceRule): string {
  const n = Math.max(1, Math.trunc(rule.interval));
  const DOW = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const every = n === 1 ? 'Every' : `Every ${n}`;

  if (rule.anchorMode === 'completion_date') {
    const unit = rule.freq === 'daily' ? 'day' : rule.freq.replace('ly', '');
    return `${n} ${unit}${n === 1 ? '' : 's'} after completion`;
  }

  switch (rule.freq) {
    case 'daily':
      return n === 1 ? 'Every day' : `Every ${n} days`;
    case 'weekly': {
      const days = (rule.byday ?? []).map((d) => DOW[d]).filter(Boolean);
      const on = days.length > 0 ? ` on ${days.join(', ')}` : '';
      return `${every} ${n === 1 ? 'week' : 'weeks'}${on}`;
    }
    case 'monthly': {
      if (rule.monthWeek !== undefined && rule.byday?.[0]) {
        const which =
          rule.monthWeek === -1 ? 'last' : ['', '1st', '2nd', '3rd', '4th', '5th'][rule.monthWeek];
        return `${every} ${n === 1 ? 'month' : 'months'} on the ${which} ${DOW[rule.byday[0]]}`;
      }
      const days = rule.bymonthday ?? [];
      const on = days.length > 0 ? ` on day ${days.map((d) => (d === -1 ? 'last' : d)).join(', ')}` : '';
      return `${every} ${n === 1 ? 'month' : 'months'}${on}`;
    }
    case 'yearly':
      return n === 1 ? 'Every year' : `Every ${n} years`;
  }
}
