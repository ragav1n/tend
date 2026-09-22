import { describe, expect, it } from 'vitest';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import { contributions } from './estimates';

/**
 * Whose estimate counts, in isolation.
 *
 * The two failures this sits between are both silent. Skipping children reads a
 * project priced by its parts as an empty week; counting everything prices the
 * same work twice. Neither shows up as an error, only as a number that is
 * quietly wrong, which is why the rule has a test rather than a comment.
 */

let n = 0;
function task(over: Partial<Task> = {}): Task {
  n += 1;
  return {
    id: `task-${n}`,
    _done: 0,
    _dueDay: NO_DUE_DAY,
    parentTaskId: '',
    estimateMinutes: null,
    ...over,
  } as unknown as Task;
}

describe('contributions', () => {
  it('counts a task on its own estimate', () => {
    const one = task({ estimateMinutes: 90 });
    expect(contributions([one]).get(one.id)).toEqual({ kind: 'minutes', minutes: 90 });
  });

  it('calls a task with no estimate blank rather than free', () => {
    const one = task();
    expect(contributions([one]).get(one.id)).toEqual({ kind: 'blank' });
  });

  it('counts a part on its own account', () => {
    const part = task({ estimateMinutes: 180, parentTaskId: 'elsewhere' });
    expect(contributions([part]).get(part.id)).toEqual({ kind: 'minutes', minutes: 180 });
  });

  it('covers a parent whose parts carry estimates', () => {
    const parent = task({ id: 'parent', estimateMinutes: 540 });
    const part = task({ estimateMinutes: 180, parentTaskId: 'parent' });

    const out = contributions([parent, part]);
    expect(out.get('parent')).toEqual({ kind: 'covered' });
    expect(out.get(part.id)).toEqual({ kind: 'minutes', minutes: 180 });
  });

  it('covers a parent that carries no estimate of its own', () => {
    // So it is not reported as work nobody has put a number on. Somebody did:
    // they put it on the parts.
    const parent = task({ id: 'whole' });
    const part = task({ estimateMinutes: 180, parentTaskId: 'whole' });

    expect(contributions([parent, part]).get('whole')).toEqual({ kind: 'covered' });
  });

  it('leaves a parent alone when no part carries an estimate', () => {
    // Splitting a task into unpriced pieces says nothing about the hours, so
    // the parent's own figure is still the only figure there is.
    const parent = task({ id: 'parent', estimateMinutes: 540 });
    const part = task({ parentTaskId: 'parent' });

    const out = contributions([parent, part]);
    expect(out.get('parent')).toEqual({ kind: 'minutes', minutes: 540 });
    expect(out.get(part.id)).toEqual({ kind: 'blank' });
  });

  it('covers a parent from one part even when its siblings are unpriced', () => {
    const parent = task({ id: 'parent', estimateMinutes: 540 });
    const priced = task({ estimateMinutes: 180, parentTaskId: 'parent' });
    const unpriced = task({ parentTaskId: 'parent' });

    const out = contributions([parent, priced, unpriced]);
    expect(out.get('parent')).toEqual({ kind: 'covered' });
    expect(out.get(unpriced.id)).toEqual({ kind: 'blank' });
  });

  it('is decided by the rows it is given, so a skipped part covers nothing', () => {
    // The caller passes the rows whose estimates it is about to count. Cover a
    // parent on the strength of a part the caller then skips and the parent's
    // figure vanishes with nothing taking its place, which is the bug this
    // function exists to undo.
    const parent = task({ id: 'parent', estimateMinutes: 540 });
    expect(contributions([parent]).get('parent')).toEqual({ kind: 'minutes', minutes: 540 });
  });
});
