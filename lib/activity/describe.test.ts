import { describe, expect, it } from 'vitest';
import { describeActivity, type DescribeContext } from './describe';
import type { ActivityAction, ActivityEntry } from '@/lib/db/types';

const TODAY = '2026-08-21';

const ctx: DescribeContext = {
  today: TODAY,
  projectName: (id) => (id === 'p1' ? 'Kitchen' : null),
  locale: 'en-GB',
};

function entry(
  action: ActivityAction,
  before: Record<string, unknown> = {},
  after: Record<string, unknown> = {},
  undoneAt: string | null = null,
): ActivityEntry {
  return {
    id: 'a1',
    userId: 'u1',
    action,
    entityTable: 'tasks',
    entityId: 't1',
    groupId: 'g1',
    before,
    after,
    summary: 'Edited "Buy milk"',
    undoneAt,
    createdAt: '2026-08-21T09:00:00.000Z',
    updatedAt: '2026-08-21T09:00:00.000Z',
    deletedAt: null,
    rowVersion: 1,
    _del: 0,
    _undone: undoneAt ? 1 : 0,
  };
}

describe('describeActivity', () => {
  it('names the action and lists nothing for anything but an update', () => {
    expect(describeActivity(entry('create', {}, { title: 'Buy milk' }), ctx)).toEqual({
      verb: 'Added',
      changes: [],
      undone: false,
    });
    expect(describeActivity(entry('complete', { status: 'active' }, { status: 'done' }), ctx).verb)
      .toBe('Completed');
    expect(describeActivity(entry('delete'), ctx).changes).toEqual([]);
  });

  it('reads a due date the way the list does', () => {
    const line = describeActivity(
      entry('update', { dueDate: null }, { dueDate: '2026-08-22' }),
      ctx,
    );
    expect(line.changes).toEqual([{ label: 'Due', from: 'None', to: 'Tomorrow' }]);
  });

  it('names a project, and calls the empty one Inbox', () => {
    const line = describeActivity(entry('update', { projectId: '' }, { projectId: 'p1' }), ctx);
    expect(line.changes).toEqual([{ label: 'Project', from: 'Inbox', to: 'Kitchen' }]);
  });

  it('does not print a uuid for a project this device has not pulled', () => {
    const line = describeActivity(entry('update', { projectId: 'p1' }, { projectId: 'p9' }), ctx);
    expect(line.changes[0]?.to).toBe('Another project');
  });

  it('names the notes field without quoting the notes', () => {
    const line = describeActivity(
      entry('update', { notes: 'old' }, { notes: 'a much longer body' }),
      ctx,
    );
    expect(line.changes).toEqual([{ label: 'Notes' }]);
  });

  it('clips a long title rather than letting it run', () => {
    const long = 'x'.repeat(80);
    const line = describeActivity(entry('update', { title: 'short' }, { title: long }), ctx);
    expect(line.changes[0]?.to).toHaveLength(40);
    expect(line.changes[0]?.to?.endsWith('…')).toBe(true);
  });

  it('leaves out the bookkeeping a completion writes', () => {
    const line = describeActivity(
      entry('update', { status: 'active', sortKey: 'a0' }, { status: 'done', spawnedId: 't2' }),
      ctx,
    );
    expect(line.changes).toEqual([{ label: 'Status', from: 'Active', to: 'Done' }]);
  });

  it('skips a field the patch set to what it already held', () => {
    const line = describeActivity(entry('update', { priority: 2 }, { priority: 2 }), ctx);
    expect(line.changes).toEqual([]);
  });

  it('reads priority and estimate as words', () => {
    const line = describeActivity(
      entry('update', { priority: 0, estimateMinutes: null }, { priority: 3, estimateMinutes: 25 }),
      ctx,
    );
    expect(line.changes).toEqual([
      { label: 'Priority', from: 'None', to: 'High' },
      { label: 'Estimate', from: 'None', to: '25 min' },
    ]);
  });

  it('marks an entry that was taken back', () => {
    const line = describeActivity(
      entry('complete', { status: 'active' }, { status: 'done' }, '2026-08-21T09:05:00.000Z'),
      ctx,
    );
    expect(line.undone).toBe(true);
  });

  it('names a field it has no label for rather than dropping it', () => {
    const line = describeActivity(entry('update', { cancelReason: null }, { cancelReason: 'skipped' }), ctx);
    expect(line.changes).toEqual([{ label: 'Cancelled as', from: 'None', to: 'skipped' }]);
  });
});
