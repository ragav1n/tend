import { parseIcs } from '@/lib/ics/parse';
import { matchCourse, readFeed, type FeedItem } from './feed';
import type { Course } from '@/lib/db/types';

/**
 * Turning a fetched calendar into the payload the SQL expects.
 *
 * Shared by the two callers that exist: the import route, which runs under a
 * person's own cookie, and the nightly cron, which runs under the service role
 * and does the same job for every account. Written down once because the two
 * drifting apart would mean "Import now" and the nightly run disagreeing about
 * what the same feed contains.
 */

export interface FeedPayload {
  items: Record<string, unknown>[];
  /** Assignments that matched no course. They land unfiled, which is visible. */
  unmatched: number;
  /** How many the feed carried that this app can file at all. */
  total: number;
}

/** A course, reduced to what the matcher reads. */
export interface MatchableCourse {
  id: string;
  code: string;
  feedLabel: string;
}

function payloadFor(item: FeedItem, courseId: string | null): Record<string, unknown> {
  if (item.kind === 'event') {
    return {
      kind: 'event',
      feed_uid: item.uid,
      title: item.title,
      starts_on: item.date,
      starts_at: item.time,
      ends_at: item.endTime,
      location: item.location,
      // `event_kind`, not `kind`: `kind` is the discriminator `import_feed`
      // branches on, and reusing it stored every exam as a plain event.
      event_kind: item.eventKind,
      course_id: courseId ?? '',
    };
  }

  return {
    kind: 'assignment',
    feed_uid: item.uid,
    title: item.title,
    due_date: item.date,
    due_time: item.time,
    course_id: courseId ?? '',
    // The link back to Canvas goes in the notes, where a markdown link already
    // renders. Storing the attachment itself would be a second sync protocol.
    notes:
      item.url === '' ? item.notes : `${item.notes}\n\n[Open in Canvas](${item.url})`.trim(),
  };
}

export function buildPayload(ics: string, courses: readonly MatchableCourse[]): FeedPayload {
  const items = readFeed(parseIcs(ics));
  let unmatched = 0;

  const payload = items.map((item) => {
    const courseId = matchCourse(item.courseHint, courses as readonly Course[]);
    if (item.kind === 'assignment' && courseId === null) unmatched += 1;
    return payloadFor(item, courseId);
  });

  return { items: payload, unmatched, total: items.length };
}

/** A feed is a few hundred events. Far past that is not a calendar. */
export const MAX_FEED_BYTES = 4_000_000;

/** Long enough for a slow campus server, short enough not to hold a request. */
export const FEED_TIMEOUT_MS = 15_000;

export type FetchOutcome = { ics: string } | { reason: string };

/**
 * Fetches one feed, reporting a reason rather than throwing.
 *
 * Never the thrown message and never the URL. The URL is credential-shaped:
 * anybody holding it can read the whole calendar, so it stays out of every log
 * line, every error body and every toast.
 */
export async function fetchFeed(url: string): Promise<FetchOutcome> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: { accept: 'text/calendar, text/plain' },
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        reason:
          response.status === 404
            ? 'the feed URL is no longer valid'
            : `the server answered ${response.status}`,
      };
    }

    const body = await response.text();
    if (body.length > MAX_FEED_BYTES) return { reason: 'the feed is too large to read' };
    if (readFeed(parseIcs(body)).length === 0) return { reason: 'nothing readable in the feed' };

    return { ics: body };
  } catch {
    return { reason: 'could not reach the feed' };
  }
}
