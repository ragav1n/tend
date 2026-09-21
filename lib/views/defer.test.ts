import { describe, expect, it } from 'vitest';
import type { Task } from '@/lib/db/types';
import { isDeferred, splitDeferred } from './defer';

const DAY = '2026-09-21';

let n = 0;
function task(startDate: string | null): Task {
  n += 1;
  return { id: `t${n}`, startDate } as unknown as Task;
}

describe('isDeferred', () => {
  it('holds a task whose start date has not arrived', () => {
    expect(isDeferred(task('2026-09-22'), DAY)).toBe(true);
  });

  it('releases a task on the day it starts', () => {
    // The boundary is the whole reason this is a function. "Starts today" means
    // today, not tomorrow.
    expect(isDeferred(task(DAY), DAY)).toBe(false);
  });

  it('releases a task whose start date has passed', () => {
    expect(isDeferred(task('2026-09-20'), DAY)).toBe(false);
  });

  it('leaves a task with no start date alone', () => {
    expect(isDeferred(task(null), DAY)).toBe(false);
  });

  it('compares as wall clock, so a year boundary is still a string compare', () => {
    expect(isDeferred(task('2027-01-01'), '2026-12-31')).toBe(true);
    expect(isDeferred(task('2026-12-31'), '2027-01-01')).toBe(false);
  });
});

describe('splitDeferred', () => {
  it('keeps the order each half arrived in', () => {
    const a = task(null);
    const b = task('2026-09-30');
    const c = task(null);
    const d = task('2026-09-25');

    const { rows, deferred } = splitDeferred([a, b, c, d], DAY);
    expect(rows.map((t) => t.id)).toEqual([a.id, c.id]);
    expect(deferred.map((t) => t.id)).toEqual([b.id, d.id]);
  });

  it('answers two empty halves for an empty list', () => {
    expect(splitDeferred([], DAY)).toEqual({ rows: [], deferred: [] });
  });
});
