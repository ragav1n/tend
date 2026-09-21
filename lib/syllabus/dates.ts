import { parseQuickAdd } from '@/lib/parse';
import type { PlainDate } from '@/lib/db/types';

/**
 * A date off a syllabus, resolved to the right year.
 *
 * `parseQuickAdd` rolls a bare month and day *forward*: typed on 21 September,
 * "Sep 14" means next year's, because somebody adding a task means the next one
 * to come. That is right for a quick-add field and wrong for a syllabus, where
 * "Sep 14" is a week ago and belongs to the term you are in. Left alone it
 * files every already-passed assignment twelve months out, which is worse than
 * not importing it: it sits in Upcoming forever and never goes overdue.
 *
 * So the year is chosen rather than accepted. A date with a year written on it is
 * taken as written. A bare month and day is tried against the term window first,
 * and failing that resolves to whichever candidate falls nearest to today.
 */

export interface DateWindow {
  today: PlainDate;
  /** The term's bounds, when the course has one. Absent means fall back to
   *  nearest-to-today, which is the best guess available. */
  termStart?: PlainDate;
  termEnd?: PlainDate;
}

/** A year appears in the text, so no inference is wanted. */
function hasYear(text: string): boolean {
  return /\b(19|20)\d{2}\b/.test(text);
}

function shiftYear(date: PlainDate, years: number): PlainDate {
  const [y, m, d] = date.split('-');
  return `${String(Number(y) + years).padStart(4, '0')}-${m}-${d}`;
}

function daysApart(a: PlainDate, b: PlainDate): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
}

/**
 * The date a syllabus line means, or null.
 *
 * `now` is passed to `parseQuickAdd` rather than read from the clock so the
 * whole resolution is a function of its inputs and a test can pin a year.
 */
export function resolveSyllabusDate(text: string, window: DateWindow): PlainDate | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const now = new Date(`${window.today}T12:00:00Z`);
  const parsed = parseQuickAdd(trimmed, now).dueDate;
  if (parsed === null) return null;

  // Written with a year, so there is nothing to infer.
  if (hasYear(trimmed)) return parsed;

  const candidates = [shiftYear(parsed, -1), parsed, shiftYear(parsed, 1)];

  const { termStart, termEnd } = window;
  if (termStart !== undefined && termEnd !== undefined) {
    const inTerm = candidates.filter((day) => day >= termStart && day <= termEnd);
    // Exactly one is the answer. Two would mean a term longer than a year,
    // which is not a term, so the nearest wins and the grid stays editable.
    if (inTerm.length === 1) return inTerm[0]!;
    if (inTerm.length > 1) return nearest(inTerm, window.today);
  }

  return nearest(candidates, window.today);
}

function nearest(days: readonly PlainDate[], today: PlainDate): PlainDate {
  return days.reduce((best, day) =>
    daysApart(day, today) < daysApart(best, today) ? day : best,
  );
}
