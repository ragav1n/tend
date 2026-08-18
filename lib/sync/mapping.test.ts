import { readFileSync } from 'node:fs';
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

describe('the table name map', () => {
  it('names only tables the migrations actually create', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '0001_core_schema.sql'),
      'utf8',
    );
    for (const wire of Object.values(WIRE_TABLE)) {
      expect(sql, wire).toContain(`create table public.${wire}`);
    }
  });

  it('inverts cleanly, so a pulled row can find its local table', () => {
    for (const [local, wire] of Object.entries(WIRE_TABLE)) {
      expect(LOCAL_TABLE[wire]).toBe(local);
    }
  });

  it('matches the tables the push RPC will accept', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '0003_sync_rpc.sql'),
      'utf8',
    );
    const writable = sql.slice(sql.indexOf('sync_writable_tables'));
    // user_settings is pulled but only ever written through its own settings
    // screen, so it is deliberately absent from the push allowlist for now.
    for (const wire of Object.values(WIRE_TABLE)) {
      if (wire === 'user_settings') continue;
      expect(writable, wire).toContain(`'${wire}'`);
    }
  });
});
