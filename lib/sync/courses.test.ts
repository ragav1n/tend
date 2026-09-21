import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localToWire } from './mapping';
import { asUser as userRole, bootPostgres, createUsers } from './testing/postgres';

/**
 * Terms, courses and components through the real RPCs.
 *
 * A new table is not finished when its migration applies. It has to be in
 * `sync_writable_tables()` so a push names it, in `sync_pull`'s union so the
 * push comes back, and in `SENTINEL_COLUMNS` for every nullable uuid a client
 * writes, or Postgres rejects `''` with a 22P02 the client classifies as fatal
 * and the whole table deadletters. Three of those are separate files and one is
 * hand-written SQL, which is why this goes through `localToWire` and the RPCs
 * rather than inserting rows directly.
 */

const USER = '00000000-0000-4000-8000-0000000c0de1';
const OTHER = '00000000-0000-4000-8000-0000000c0de2';

const TERM = '10000000-0000-4000-8000-000000000001';
const COURSE = '20000000-0000-4000-8000-000000000001';
const COMPONENT = '30000000-0000-4000-8000-000000000001';
const TASK = '40000000-0000-4000-8000-000000000001';

let db: PGlite;
let mutations = 0;

/** Wire table names, because that is what a push carries: `push.ts` maps the
 *  local name through `WIRE_TABLE` before it ever reaches the RPC. */
function mutation(table: string, entityId: string, local: Record<string, unknown>) {
  mutations += 1;
  return {
    mutationId: `99999999-0000-4000-8000-${String(mutations).padStart(12, '0')}`,
    table,
    entityId,
    op: 'insert',
    patch: localToWire(table as Parameters<typeof localToWire>[0], local),
    baseVersion: 0,
  };
}

async function push(payload: unknown[]) {
  const result = await db.query<{ sync_push: { results: { status: string }[] } }>(
    'select public.sync_push($1::jsonb) as sync_push',
    [JSON.stringify(payload)],
  );
  return result.rows[0]!.sync_push;
}

async function pull(cursor = 0) {
  const result = await db.query<{
    sync_pull: { rows: { table: string; row: Record<string, unknown> }[] };
  }>('select public.sync_pull($1, 500) as sync_pull', [cursor]);
  return result.rows[0]!.sync_pull;
}

const term = (over: Record<string, unknown> = {}) => ({
  id: TERM,
  userId: 'local',
  name: 'Fall 2026',
  startDate: '2026-08-17',
  endDate: '2026-12-11',
  sortKey: 'a0',
  createdAt: '2026-08-17T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const course = (over: Record<string, unknown> = {}) => ({
  id: COURSE,
  userId: 'local',
  termId: TERM,
  code: 'CS 6035',
  name: 'Introduction to Information Security',
  color: '#8D321F',
  creditHours: 3,
  instructor: 'Wenke Lee',
  meetings: [{ byday: 2, start: '09:30', end: '10:45', location: 'Klaus 1116' }],
  gradeScale: [],
  status: 'active',
  notes: '',
  sortKey: 'a0',
  createdAt: '2026-08-17T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const component = (over: Record<string, unknown> = {}) => ({
  id: COMPONENT,
  userId: 'local',
  courseId: COURSE,
  name: 'Projects',
  weight: 60,
  dropLowest: 0,
  sortKey: 'a0',
  createdAt: '2026-08-17T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

const task = (over: Record<string, unknown> = {}) => ({
  id: TASK,
  userId: 'local',
  projectId: '',
  parentTaskId: '',
  seriesId: '',
  title: 'Project 1: buffer overflow',
  notes: '',
  status: 'active',
  priority: 0,
  dueDate: '2026-09-14',
  dueTime: '23:59',
  startDate: null,
  plannedFor: null,
  estimateMinutes: 240,
  cancelReason: null,
  archivedAt: null,
  sortKey: 'a0',
  plannedSortKey: 'a0',
  occurrenceDate: null,
  occurrenceSeq: null,
  courseId: COURSE,
  componentId: COMPONENT,
  pointsPossible: 100,
  pointsEarned: null,
  gradedAt: null,
  createdAt: '2026-08-17T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

beforeAll(async () => {
  db = await bootPostgres();
  await createUsers(db, [USER, OTHER]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('a course through the sync channel', () => {
  it('pushes a term, a course, a component and a task that names both', async () => {
    await userRole(db, USER);

    const response = await push([
      mutation('terms', TERM, term()),
      mutation('courses', COURSE, course()),
      mutation('course_components', COMPONENT, component()),
      mutation('tasks', TASK, task()),
    ]);

    expect(response.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
  });

  it('pulls all four back, which the writable list alone does not give', async () => {
    await userRole(db, USER);
    const page = await pull(0);

    const byTable = new Map(page.rows.map((r) => [r.table, r.row]));
    expect([...byTable.keys()].sort()).toEqual(
      expect.arrayContaining(['course_components', 'courses', 'tasks', 'terms']),
    );
    expect(byTable.get('courses')!.code).toBe('CS 6035');
    expect(byTable.get('terms')!.name).toBe('Fall 2026');
    // `to_jsonb` renders a numeric as a JSON number, so weights and points
    // arrive as JS numbers and the grade arithmetic needs no parsing. Worth
    // asserting rather than assuming: a string here would make every weighted
    // average concatenate.
    expect(byTable.get('course_components')!.weight).toBe(60);
  });

  it('turns the empty-string sentinels back into real nulls', async () => {
    await userRole(db, USER);

    // '' is not a uuid. Postgres rejects it with a 22P02 the client treats as
    // fatal, so a missing sentinel column deadletters every row of that table.
    const loose = '40000000-0000-4000-8000-000000000002';
    const response = await push([
      mutation('tasks', loose, task({ id: loose, courseId: '', componentId: '' })),
    ]);
    expect(response.results.map((r) => r.status)).toEqual(['applied']);

    const { rows } = await db.query<{ course_id: string | null; component_id: string | null }>(
      'select course_id, component_id from public.tasks where id = $1',
      [loose],
    );
    expect(rows[0]).toEqual({ course_id: null, component_id: null });
  });

  it('keeps the grade off the wire in either direction', async () => {
    await userRole(db, USER);
    const page = await pull(0);
    const row = page.rows.find((r) => r.table === 'tasks' && r.row.id === TASK)!.row;

    // Points are the client's to write, unlike completed_at. What must not
    // travel is the tenancy column.
    expect(row.points_possible).toBe(100);
    expect(row.points_earned).toBeNull();
    expect(row).not.toHaveProperty('user_id');
  });

  it('refuses a course belonging to somebody else', async () => {
    await userRole(db, OTHER);

    // The composite tenancy foreign key: the denormalized user_id cannot lie
    // about which account the parent belongs to.
    const theirs = '40000000-0000-4000-8000-000000000003';
    const response = await push([
      mutation('tasks', theirs, task({ id: theirs, courseId: COURSE, componentId: '' })),
    ]);
    expect(response.results[0]!.status).not.toBe('applied');
  });

  it('refuses a second course with the same code in one term', async () => {
    await userRole(db, USER);

    const twin = '20000000-0000-4000-8000-000000000002';
    const response = await push([
      mutation('courses', twin, course({ id: twin, code: 'cs 6035' })),
    ]);
    // Case folded, so the index catches the same course typed differently.
    expect(response.results[0]!.status).not.toBe('applied');
  });

  it('allows the same code in a different term', async () => {
    await userRole(db, USER);

    const spring = '10000000-0000-4000-8000-000000000002';
    const retake = '20000000-0000-4000-8000-000000000003';
    const response = await push([
      mutation('terms', spring, term({ id: spring, name: 'Spring 2027', startDate: '2027-01-11', endDate: '2027-05-07' })),
      mutation('courses', retake, course({ id: retake, termId: spring })),
    ]);
    expect(response.results.map((r) => r.status)).toEqual(['applied', 'applied']);
  });

  it('refuses a term that ends before it starts', async () => {
    await userRole(db, USER);

    const backwards = '10000000-0000-4000-8000-000000000009';
    const response = await push([
      mutation('terms', backwards, term({ id: backwards, startDate: '2026-12-11', endDate: '2026-08-17' })),
    ]);
    expect(response.results[0]!.status).not.toBe('applied');
  });
});
