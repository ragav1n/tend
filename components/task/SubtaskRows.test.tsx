// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import { SubtaskRows, subtaskProgress } from './SubtaskRows';

// This repo does not enable vitest globals, so testing-library's own auto
// cleanup never registers and renders pile up across cases.
afterEach(cleanup);

let n = 0;
function sub(title: string, done = false): Task {
  return {
    id: `s${n++}`,
    userId: 'local',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    rowVersion: 0,
    projectId: '',
    parentTaskId: 'parent',
    seriesId: '',
    depth: 1,
    title,
    notes: '',
    status: done ? 'done' : 'active',
    priority: 0,
    dueDate: null,
    dueTime: null,
    startDate: null,
    plannedFor: null,
    estimateMinutes: null,
    completedAt: null,
    cancelReason: null,
    archivedAt: null,
    sortKey: `a${n}`,
    plannedSortKey: `a${n}`,
    occurrenceDate: null,
    occurrenceSeq: null,
    _del: 0,
    _done: done ? 1 : 0,
    _dueDay: NO_DUE_DAY,
    _plannedDay: NO_DUE_DAY,
    _tagIds: [],
    _words: [],
  };
}

describe('subtaskProgress', () => {
  it('counts what is done out of the whole', () => {
    expect(subtaskProgress([sub('a', true), sub('b'), sub('c')])).toBe('1/3');
  });

  it('says nothing when there are no children', () => {
    expect(subtaskProgress([])).toBeNull();
    expect(subtaskProgress(undefined)).toBeNull();
  });
});

describe('SubtaskRows', () => {
  it('renders every child when there are few', () => {
    render(<SubtaskRows subtasks={[sub('Pack kitchen'), sub('Book a van')]} onToggle={() => {}} />);
    expect(screen.getByText('Pack kitchen')).toBeTruthy();
    expect(screen.getByText('Book a van')).toBeTruthy();
    // No collapse control, because nothing is collapsed.
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
  });

  it('checks off a child in place, which is the whole point', () => {
    const onToggle = vi.fn();
    const child = sub('Pack kitchen');
    render(<SubtaskRows subtasks={[child]} onToggle={onToggle} />);

    fireEvent.click(screen.getByLabelText('Complete Pack kitchen'));
    expect(onToggle).toHaveBeenCalledWith(child.id, true);
  });

  it('reopens one that is already done', () => {
    const onToggle = vi.fn();
    const child = sub('Pack kitchen', true);
    render(<SubtaskRows subtasks={[child]} onToggle={onToggle} />);

    fireEvent.click(screen.getByLabelText('Reopen Pack kitchen'));
    expect(onToggle).toHaveBeenCalledWith(child.id, false);
  });

  it('collapses past three and says how many are hidden', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((t) => sub(t));
    render(<SubtaskRows subtasks={many} onToggle={() => {}} />);

    expect(screen.queryByText('d')).toBeNull();
    expect(screen.getByText('3 more')).toBeTruthy();
    // The count is what carries the information once the rows are hidden.
    expect(screen.getByText('0/6')).toBeTruthy();
  });

  it('expands and collapses again', async () => {
    const many = ['a', 'b', 'c', 'd'].map((t) => sub(t));
    render(<SubtaskRows subtasks={many} onToggle={() => {}} />);

    fireEvent.click(screen.getByText('1 more'));
    expect(screen.getByText('d')).toBeTruthy();

    fireEvent.click(screen.getByText('Show fewer'));
    // The label flips at once. The row itself lingers for its exit animation,
    // which is what AnimatePresence is for, so it goes on a tick rather than
    // synchronously.
    expect(screen.getByText('1 more')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('d')).toBeNull());
  });

  it('shows the open ones first while collapsed', () => {
    // Otherwise a parent with three finished children and two live ones looks
    // done at a glance, which is the opposite of what a checklist is for.
    const rows = [sub('done 1', true), sub('done 2', true), sub('done 3', true), sub('live')];
    render(<SubtaskRows subtasks={rows} onToggle={() => {}} />);

    expect(screen.getByText('live')).toBeTruthy();
    expect(screen.getByText('3/4')).toBeTruthy();
  });

  it('renders nothing at all for an empty list', () => {
    const { container } = render(<SubtaskRows subtasks={[]} onToggle={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
