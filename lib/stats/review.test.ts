import { describe, expect, it } from 'vitest';
import {
  dayBounds,
  localDay,
  peak,
  startOfWeek,
  streakLength,
  summarize,
  weekBounds,
  weekDays,
} from './review';
import type { FocusSession, Task } from '@/lib/db/types';

/** An instant at noon local time on `date`, which is what a real completion
 *  looks like and what makes these assertions zone-independent. */
function atNoon(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

function done(date: string | null, id = date ?? 'x'): Task {
  return {
    id,
    completedAt: date === null ? null : atNoon(date),
    status: 'done',
    _done: 1,
  } as Task;
}

function session(date: string, seconds: number): FocusSession {
  return { id: `${date}-${seconds}`, startedAt: atNoon(date), focusedSeconds: seconds } as FocusSession;
}

describe('week arithmetic', () => {
  it('finds the week start for either convention', () => {
    // 2026-08-19 is a Wednesday.
    expect(startOfWeek('2026-08-19', 1)).toBe('2026-08-17');
    expect(startOfWeek('2026-08-19', 7)).toBe('2026-08-16');
    expect(startOfWeek('2026-08-17', 1)).toBe('2026-08-17');
  });

  it('lists seven consecutive days', () => {
    expect(weekDays('2026-08-17')).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
  });

  it('bounds a day at local midnight, not UTC midnight', () => {
    const { from, to } = dayBounds('2026-08-19');
    expect(localDay(from)).toBe('2026-08-19');
    expect(localDay(to)).toBe('2026-08-19');
    // One millisecond later is the next day, which is what makes the range
    // inclusive on both ends without overlapping the next one.
    expect(localDay(new Date(new Date(to).getTime() + 1).toISOString())).toBe('2026-08-20');
  });

  it('bounds a whole week', () => {
    const { from, to } = weekBounds('2026-08-17');
    expect(localDay(from)).toBe('2026-08-17');
    expect(localDay(to)).toBe('2026-08-23');
  });
});

describe('summarize', () => {
  const days = weekDays('2026-08-17');

  it('buckets completions and focus into the days they happened', () => {
    const summary = summarize(
      days,
      [done('2026-08-17'), done('2026-08-19', 'a'), done('2026-08-19', 'b')],
      [session('2026-08-19', 1500), session('2026-08-19', 600), session('2026-08-21', 900)],
      '2026-08-19',
    );

    expect(summary.completed).toBe(3);
    expect(summary.focusSeconds).toBe(3000);
    expect(summary.days[0]).toEqual({ date: '2026-08-17', completed: 1, focusSeconds: 0 });
    expect(summary.days[2]).toEqual({ date: '2026-08-19', completed: 2, focusSeconds: 2100 });
    expect(summary.days[4]).toEqual({ date: '2026-08-21', completed: 0, focusSeconds: 900 });
  });

  it('ignores anything outside the week it was asked about', () => {
    const summary = summarize(days, [done('2026-08-10'), done('2026-09-01')], [], '2026-08-19');
    expect(summary.completed).toBe(0);
    expect(summary.best).toBeNull();
  });

  it('skips a closed task with no completion instant, which is a cancelled one', () => {
    const summary = summarize(days, [done(null, 'cancelled')], [], '2026-08-19');
    expect(summary.completed).toBe(0);
  });

  it('names the busiest day', () => {
    const summary = summarize(
      days,
      [done('2026-08-17'), done('2026-08-19', 'a'), done('2026-08-19', 'b')],
      [],
      '2026-08-19',
    );
    expect(summary.best!.date).toBe('2026-08-19');
  });
});

describe('the streak', () => {
  it('counts back from today when today has something', () => {
    const tasks = [done('2026-08-19'), done('2026-08-18'), done('2026-08-17')];
    expect(streakLength(tasks, '2026-08-19')).toBe(3);
  });

  it('does not break at 9am, because the day is not over', () => {
    const tasks = [done('2026-08-18'), done('2026-08-17')];
    expect(streakLength(tasks, '2026-08-19')).toBe(2);
  });

  it('breaks on a genuine gap', () => {
    const tasks = [done('2026-08-18'), done('2026-08-16')];
    expect(streakLength(tasks, '2026-08-19')).toBe(1);
  });

  it('is zero when the last two days are empty', () => {
    expect(streakLength([done('2026-08-16')], '2026-08-19')).toBe(0);
    expect(streakLength([], '2026-08-19')).toBe(0);
  });

  it('counts a day once however much was finished on it', () => {
    const tasks = [done('2026-08-19', 'a'), done('2026-08-19', 'b'), done('2026-08-18')];
    expect(streakLength(tasks, '2026-08-19')).toBe(2);
  });
});

describe('peak', () => {
  it('floors at one so an empty week draws flat', () => {
    expect(peak([{ date: '2026-08-17', completed: 0, focusSeconds: 0 }])).toBe(1);
    expect(
      peak([
        { date: '2026-08-17', completed: 4, focusSeconds: 0 },
        { date: '2026-08-18', completed: 2, focusSeconds: 0 },
      ]),
    ).toBe(4);
  });
});
