import type { IcsEvent } from '@/lib/ics/parse';
import type { Course } from '@/lib/db/types';

/**
 * What a Canvas feed item means.
 *
 * Canvas exposes one ICS URL per person covering every enrolled course, and the
 * two things in it want opposite treatment:
 *
 *   - An **assignment** is work with a deadline, so it becomes a task you can
 *     complete, reschedule and be reminded about.
 *   - A **calendar event** is a lecture, an exam slot, an office hour. It is not
 *     work and ticking it off means nothing, so it becomes a read-only row that
 *     renders behind the day rather than a task in a list.
 *
 * They are told apart by the UID prefix rather than by guessing from the title,
 * because Canvas mints them from different tables and the prefix is the only
 * part of the feed that says so outright. A title heuristic would file "Read
 * chapter 4" and "Lecture 4" the same way.
 *
 * The feed carries only what an instructor entered with a date on it. Anything
 * that lives in the syllabus and nowhere else is invisible here, which is why
 * the paste importer exists beside this rather than instead of it.
 */

export type FeedKind = 'assignment' | 'event';

/** A guess at what a course event is, from its title. Canvas does not say. */
export type EventKind = 'event' | 'exam' | 'class';

export interface FeedItem {
  kind: FeedKind;
  /** Stable across imports. The basis of importing the same feed twice without
   *  duplicating it. */
  uid: string;
  title: string;
  /** The `[CS-6035-O01]` suffix, unresolved. Null when the summary had none. */
  courseHint: string | null;
  date: string;
  /** Null for an all-day item, which is how Canvas writes an undated-time
   *  assignment and every calendar-day event. */
  time: string | null;
  endTime: string | null;
  location: string;
  url: string;
  notes: string;
  /** Only meaningful when `kind` is 'event'. */
  eventKind: EventKind;
}

/** UID prefixes Canvas uses. Anything else is skipped rather than guessed at. */
const ASSIGNMENT_PREFIX = 'event-assignment-';
const EVENT_PREFIX = 'event-calendar-event-';

/**
 * Splits `Project 1 [CS-6035-O01]` into a title and a course hint.
 *
 * Canvas appends the course code in brackets to every summary in the feed,
 * which is the only thing connecting an item to a course: the ICS format has no
 * field for it. Only a trailing bracket counts, so "Problem set [2] revisited"
 * keeps its brackets and its whole title.
 */
export function splitSummary(summary: string): { title: string; hint: string | null } {
  const match = /^(.*)\s\[([^\]]+)\]\s*$/.exec(summary.trim());
  if (!match) return { title: summary.trim(), hint: null };

  const title = match[1]!.trim();
  // A summary that is nothing but a bracket keeps it as the title, or the item
  // would import with no name at all.
  if (title === '') return { title: summary.trim(), hint: null };

  return { title, hint: match[2]!.trim() };
}

/**
 * Whether a course event looks like an exam.
 *
 * A heuristic, and labelled one. Canvas has no field for it, and the exam radar
 * is worth more than the cost of occasionally promoting a review session. Word
 * boundaries matter: "finalise the report" is not a final.
 */
export function eventKindOf(title: string): EventKind {
  if (/\b(exam|midterm|final|finals|quiz|test)\b/i.test(title)) return 'exam';
  if (/\b(lecture|class|lab|seminar|recitation|tutorial|office hours?)\b/i.test(title)) {
    return 'class';
  }
  return 'event';
}

/**
 * One parsed VEVENT as something this app can file, or nothing.
 *
 * Nothing when the UID is a shape Canvas did not mint, or when there is no
 * readable date. An item with no date is one the app has nothing to say about,
 * and inventing today for it would put somebody else's blank field on your
 * Today list.
 */
export function classify(event: IcsEvent): FeedItem | null {
  const local = event.uid.split('@')[0] ?? '';

  const kind: FeedKind | null = local.startsWith(ASSIGNMENT_PREFIX)
    ? 'assignment'
    : local.startsWith(EVENT_PREFIX)
      ? 'event'
      : null;

  if (kind === null || event.start === null) return null;

  const { title, hint } = splitSummary(event.summary);
  if (title === '') return null;

  return {
    kind,
    uid: event.uid,
    title,
    courseHint: hint,
    date: event.start.date,
    time: event.start.time,
    endTime: event.end?.time ?? null,
    location: event.location,
    url: event.url,
    notes: event.description,
    eventKind: kind === 'event' ? eventKindOf(title) : 'event',
  };
}

/** Everything in a feed that this app can file, in feed order. */
export function readFeed(events: readonly IcsEvent[]): FeedItem[] {
  const items: FeedItem[] = [];
  for (const event of events) {
    const item = classify(event);
    if (item) items.push(item);
  }
  return items;
}

/** Lowercased and stripped to letters and digits, so "CS 6035", "cs-6035" and
 *  "CS6035" are one thing. The same fold `+code` in quick-add uses. */
function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The course a feed item belongs to, or null.
 *
 * Canvas writes its own course code, which is rarely the one you would type:
 * `CS-6035-O01` and `2026Fall-CS-6035-A` are both common for a course you call
 * CS 6035. So three passes, most specific first:
 *
 *   1. `feedLabel`, when you have told the course what Canvas calls it. An
 *      explicit answer beats any amount of guessing.
 *   2. The course code appearing inside the hint, folded. This is what catches
 *      the section and term decorations Canvas adds.
 *   3. The hint appearing inside the course code, for a feed that abbreviates.
 *
 * Ambiguity resolves to null rather than to a coin flip. Two courses whose
 * folded codes both sit inside one hint means the app cannot know, and filing
 * a deadline under the wrong course is worse than leaving it in the Inbox where
 * it is visible.
 */
export function matchCourse(
  hint: string | null,
  courses: readonly Course[],
): string | null {
  if (hint === null) return null;
  const wanted = fold(hint);
  if (wanted === '') return null;

  const labelled = courses.filter(
    (course) => course.feedLabel !== '' && fold(course.feedLabel) === wanted,
  );
  if (labelled.length === 1) return labelled[0]!.id;

  const contained = courses.filter(
    (course) => course.code !== '' && wanted.includes(fold(course.code)),
  );
  if (contained.length === 1) return contained[0]!.id;

  const reversed = courses.filter(
    (course) => course.code !== '' && fold(course.code).includes(wanted),
  );
  if (reversed.length === 1) return reversed[0]!.id;

  return null;
}
