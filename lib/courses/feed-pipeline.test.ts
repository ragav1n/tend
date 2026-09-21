import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, bootPostgres, createUsers } from '@/lib/sync/testing/postgres';
import { parseIcs } from '@/lib/ics/parse';
import type { Course } from '@/lib/db/types';
import { matchCourse, readFeed } from './feed';

/**
 * A whole Canvas feed, from the bytes to the rows.
 *
 * Parse, classify, match a course, and write through the same SQL a request
 * uses. The only seam this leaves untested is the HTTP fetch and the
 * supabase-js RPC call, both of which are a line each in the route.
 *
 * The fixture is a trimmed real feed: a folded description, the `[CS-6035-O01]`
 * suffix, both UID prefixes, an all-day event beside zoned ones, a VTIMEZONE
 * whose DTSTART belongs to a transition rule, and one assignment for a course
 * that does not exist here so the unmatched path is exercised too.
 */

let pg: PGlite;
const USER = '00000000-0000-4000-8000-00000000pipe'.replace('pipe', '9999');
const COURSE = '20000000-0000-4000-8000-000000009999';

const FEED = readFileSync(join(__dirname, 'fixtures/canvas.ics'), 'utf8');

/** The route's own payload builder, kept in step by being the same shape. */
function toPayload(
  item: ReturnType<typeof readFeed>[number],
  courseId: string | null,
): Record<string, unknown> {
  if (item.kind === 'event') {
    return {
      kind: 'event',
      feed_uid: item.uid,
      title: item.title,
      starts_on: item.date,
      starts_at: item.time,
      ends_at: item.endTime,
      location: item.location,
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
    notes: item.url === '' ? item.notes : `${item.notes}\n\n[Open in Canvas](${item.url})`.trim(),
  };
}

async function importFeed(courses: readonly Course[]) {
  const items = readFeed(parseIcs(FEED));
  let unmatched = 0;
  const payload = items.map((item) => {
    const courseId = matchCourse(item.courseHint, courses);
    if (item.kind === 'assignment' && courseId === null) unmatched += 1;
    return toPayload(item, courseId);
  });

  await asUser(pg, USER);
  const result = await pg.query<{ import_feed: Record<string, number> }>(
    'select public.import_feed($1::jsonb) as import_feed',
    [JSON.stringify(payload)],
  );
  await pg.exec(`reset role; set request.jwt.claims = '';`);

  return { counts: result.rows[0]!.import_feed, unmatched, items };
}

beforeAll(async () => {
  pg = await bootPostgres();
  await createUsers(pg, [USER]);
  await pg.query(
    `insert into public.courses (id, user_id, code, sort_key) values ($1, $2, 'CS 6035', 'a0')`,
    [COURSE, USER],
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe('a Canvas feed, end to end', () => {
  const courses = () => [{ id: COURSE, code: 'CS 6035', feedLabel: '' } as Course];

  it('reads the feed into the counts a person is shown', async () => {
    const { counts, unmatched } = await importFeed(courses());

    // Three assignments and two calendar events. The VTIMEZONE contributes
    // nothing, which is the point of skipping it.
    expect(counts).toMatchObject({ inserted: 3, updated: 0, events: 2 });
    // The history reading belongs to HIST-2100, which is not a course here.
    expect(unmatched).toBe(1);
  });

  it('files the matched work under its course and leaves the rest visible', async () => {
    await pg.exec('reset role');
    const rows = await pg.query<{ title: string; course_id: string | null; due_time: string | null }>(
      'select title, course_id, due_time from public.tasks where user_id = $1 order by title',
      [USER],
    );

    expect(rows.rows.map((row) => row.title)).toEqual([
      'Project 2: Web Security',
      'Project 3: Malware Analysis',
      'Reading response',
    ]);
    expect(rows.rows[0]!.course_id).toBe(COURSE);
    expect(rows.rows[0]!.due_time).toBe('23:59:00');
    // Unmatched, so it sits unfiled in the Inbox rather than being dropped.
    expect(rows.rows[2]!.course_id).toBeNull();
  });

  it('keeps the folded description and the way back to Canvas', async () => {
    await pg.exec('reset role');
    const row = await pg.query<{ notes: string }>(
      'select notes from public.tasks where feed_uid = $1',
      ['event-assignment-77001@canvas.instructure.com'],
    );
    expect(row.rows[0]!.notes).toContain(
      'Cross-site scripting and SQL injection. See the rubric in Canvas for the breakdown, and note the late policy.',
    );
    expect(row.rows[0]!.notes).toContain('[Open in Canvas](https://gatech.instructure.com');
  });

  it('tells an exam from a lecture', async () => {
    await pg.exec('reset role');
    const rows = await pg.query<{ title: string; kind: string }>(
      'select title, kind from public.course_events where user_id = $1 order by title',
      [USER],
    );
    expect(rows.rows).toEqual([
      { title: 'Lecture 6: Access Control', kind: 'class' },
      { title: 'Midterm Exam', kind: 'exam' },
    ]);
  });

  it('converges when the same feed is read again', async () => {
    // The nightly case. Nothing new, nothing duplicated.
    const { counts } = await importFeed(courses());
    expect(counts).toMatchObject({ inserted: 0, updated: 3, events: 2 });

    await pg.exec('reset role');
    const count = await pg.query<{ n: number }>(
      'select count(*)::int as n from public.tasks where user_id = $1',
      [USER],
    );
    expect(count.rows[0]!.n).toBe(3);
  });

  it('picks up a course added after the first import', async () => {
    // The unmatched reading response finds its home once the course exists,
    // because the feed fills a course link in even though it never takes one
    // away.
    await pg.exec('reset role');
    const hist = '20000000-0000-4000-8000-000000008888';
    await pg.query(
      `insert into public.courses (id, user_id, code, sort_key) values ($1, $2, 'HIST 2100', 'a1')`,
      [hist, USER],
    );

    await importFeed([
      { id: COURSE, code: 'CS 6035', feedLabel: '' } as Course,
      { id: hist, code: 'HIST 2100', feedLabel: '' } as Course,
    ]);

    await pg.exec('reset role');
    const row = await pg.query<{ course_id: string | null }>(
      'select course_id from public.tasks where title = $1',
      ['Reading response'],
    );
    expect(row.rows[0]!.course_id).toBe(hist);
  });

  it('leaves a deadline you moved where you put it', async () => {
    await pg.exec('reset role');
    await pg.query(
      `update public.tasks set due_date = '2026-10-09' where feed_uid = $1`,
      ['event-assignment-77001@canvas.instructure.com'],
    );

    await importFeed(courses());

    await pg.exec('reset role');
    const row = await pg.query<{ due_date: Date }>(
      'select due_date from public.tasks where feed_uid = $1',
      ['event-assignment-77001@canvas.instructure.com'],
    );
    expect(row.rows[0]!.due_date.toISOString().slice(0, 10)).toBe('2026-10-09');
  });

  it('never brings back something you deleted', async () => {
    await pg.exec('reset role');
    await pg.query(`update public.tasks set deleted_at = now() where title = $1`, [
      'Project 3: Malware Analysis',
    ]);

    await importFeed(courses());

    await pg.exec('reset role');
    const row = await pg.query<{ deleted_at: Date | null }>(
      'select deleted_at from public.tasks where title = $1',
      ['Project 3: Malware Analysis'],
    );
    expect(row.rows[0]!.deleted_at).not.toBeNull();
  });
});
