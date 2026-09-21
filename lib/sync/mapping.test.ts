import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localToWire, tagIdsOf, toCamelCase, toSnakeCase, wireToLocal } from './mapping';
import { LOCAL_TABLE, WIRE_TABLE } from './protocol';

describe('case conversion', () => {
  it.each([
    ['projectId', 'project_id'],
    ['parentTaskId', 'parent_task_id'],
    ['estimateMinutes', 'estimate_minutes'],
    ['plannedSortKey', 'planned_sort_key'],
    ['endsAfterCount', 'ends_after_count'],
    ['title', 'title'],
  ])('%s <-> %s', (camel, snake) => {
    expect(toSnakeCase(camel)).toBe(snake);
    expect(toCamelCase(snake)).toBe(camel);
  });

  it('round trips every column name a task carries', () => {
    const columns = [
      'projectId', 'parentTaskId', 'seriesId', 'dueDate', 'dueTime', 'startDate',
      'plannedFor', 'estimateMinutes', 'cancelReason', 'archivedAt', 'sortKey',
      'plannedSortKey', 'occurrenceDate', 'occurrenceSeq', 'createdAt', 'updatedAt',
      'deletedAt', 'rowVersion',
    ];
    for (const column of columns) {
      expect(toCamelCase(toSnakeCase(column))).toBe(column);
    }
  });
});

describe('local to wire', () => {
  it('turns the empty-string sentinels into null', () => {
    // IndexedDB cannot index null, so the local row uses ''. Postgres has a
    // foreign key that would reject an empty uuid.
    const wire = localToWire('tasks', {
      projectId: '',
      parentTaskId: '',
      seriesId: '',
      title: 'Buy oat milk',
    });
    expect(wire).toEqual({
      project_id: null,
      parent_task_id: null,
      series_id: null,
      title: 'Buy oat milk',
    });
  });

  it('leaves a real id alone', () => {
    const wire = localToWire('tasks', { projectId: 'abc', parentTaskId: 'def' });
    expect(wire).toEqual({ project_id: 'abc', parent_task_id: 'def' });
  });

  it('drops every derived field', () => {
    const wire = localToWire('tasks', {
      title: 'x',
      _del: 0,
      _done: 1,
      _dueDay: '9999-12-31',
      _plannedDay: '9999-12-31',
      _tagIds: ['a'],
      _words: ['x'],
    });
    expect(wire).toEqual({ title: 'x' });
  });

  it('does not apply task sentinels to other tables', () => {
    // Only tasks has columns that use '' for absent. A project name that
    // happens to be empty must stay an empty string.
    expect(localToWire('projects', { name: '' })).toEqual({ name: '' });
  });

  it('keeps a genuine null as null', () => {
    expect(localToWire('tasks', { dueDate: null })).toEqual({ due_date: null });
  });
});

describe('wire to local', () => {
  it('turns null back into the sentinel', () => {
    const local = wireToLocal('tasks', {
      id: 'a',
      project_id: null,
      parent_task_id: null,
      series_id: null,
      due_date: null,
    });
    expect(local).toMatchObject({
      projectId: '',
      parentTaskId: '',
      seriesId: '',
      // due_date is genuinely nullable locally, so it stays null.
      dueDate: null,
    });
  });

  it('strips tag_ids, which the caller applies to the join table instead', () => {
    const row = { id: 'a', title: 'x', tag_ids: ['t1', 't2'] };
    expect(wireToLocal('tasks', row)).toEqual({ id: 'a', title: 'x' });
    expect(tagIdsOf(row)).toEqual(['t1', 't2']);
  });

  it('reports a missing tag set as null rather than empty', () => {
    // Empty means "this task has no tags" and null means "the server did not
    // say", and applying the first when you meant the second wipes tags.
    expect(tagIdsOf({ id: 'a' })).toBeNull();
    expect(tagIdsOf({ id: 'a', tag_ids: [] })).toEqual([]);
  });

  it('survives a round trip through both directions', () => {
    const local = {
      id: 'a',
      projectId: '',
      parentTaskId: '',
      seriesId: '',
      title: 'Buy oat milk',
      dueDate: '2026-08-20',
      estimateMinutes: 15,
    };
    expect(wireToLocal('tasks', localToWire('tasks', local))).toEqual(local);
  });
});

/**
 * Every migration, joined, and the newest definition of a function.
 *
 * Reading one file was enough while the schema was one file. A table added in
 * 0016 and an allowlist rewritten in 0007 both broke that: `create or replace`
 * has no partial form, so the last definition is the only one that runs.
 */
const DIR = join(process.cwd(), 'supabase', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const SQL = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]));
const ALL = Object.values(SQL).join('\n');

function newestDefinition(name: string): string {
  const owner = FILES.filter((file) =>
    SQL[file]!.includes(`create or replace function public.${name}`),
  ).pop()!;
  const source = SQL[owner]!;
  const start = source.indexOf(`create or replace function public.${name}`);
  return source.slice(start, source.indexOf('$$;', start));
}

/**
 * Tables the client reads and never writes.
 *
 * They ride the pull like anything else and are absent from
 * `sync_writable_tables()`, which is the whole of what "server-owned" means in
 * this protocol. `course_events` come from a Canvas feed: a lecture is not work,
 * so there is nothing for a client to say about one.
 */
const READ_ONLY = new Set<string>(['course_events']);

describe('the table name map', () => {
  it('names only tables the migrations actually create', () => {
    for (const wire of Object.values(WIRE_TABLE)) {
      // `if not exists` is a form the migrations use, so the match allows it
      // rather than reporting a table that plainly exists as missing.
      const created = new RegExp(`create table (if not exists )?public\\.${wire}\\b`);
      expect(created.test(ALL), wire).toBe(true);
    }
  });

  it('inverts cleanly, so a pulled row can find its local table', () => {
    for (const [local, wire] of Object.entries(WIRE_TABLE)) {
      expect(LOCAL_TABLE[wire]).toBe(local);
    }
  });

  it('matches the tables the push RPC will accept', () => {
    // A table the client can name in a mutation but the server will not accept
    // comes back 42501, which the client classifies as fatal: every mutation
    // for that table dies in the deadletter rather than retrying.
    const writable = newestDefinition('sync_writable_tables');
    for (const wire of Object.values(WIRE_TABLE)) {
      if (READ_ONLY.has(wire)) continue;
      expect(writable, wire).toContain(`'${wire}'`);
    }
  });

  it('keeps the server-owned tables out of the writable list', () => {
    // "Server-owned" is not a comment, it is this: in the pull union and out of
    // `sync_writable_tables()`, with a SELECT policy and nothing else. Listing
    // one here by accident would let a client invent its own course events.
    const writable = newestDefinition('sync_writable_tables');
    for (const wire of READ_ONLY) {
      expect(writable, wire).not.toContain(`'${wire}'`);
    }
  });

  it('gives every read-only table a select policy and no other', () => {
    for (const wire of READ_ONLY) {
      expect(ALL).toContain(`create policy ${wire}_select on public.${wire}`);
      expect(ALL).not.toContain(`create policy ${wire}_insert`);
      expect(ALL).not.toContain(`create policy ${wire}_update`);
    }
  });

  it('is pulled by the RPC as well as pushed to it', () => {
    // A local table with no arm in sync_pull syncs one way and looks fine
    // until the second device.
    const pull = newestDefinition('sync_pull');
    for (const wire of Object.values(WIRE_TABLE)) {
      expect(pull, wire).toContain(`from public.${wire}`);
    }
  });
});
