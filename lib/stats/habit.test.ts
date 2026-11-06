import { describe, expect, it } from 'vitest';
import type { RecurrenceRule } from '@/lib/recurrence';
import { addDays } from '@/lib/recurrence';
import type { PlainDate, Task } from '@/lib/db/types';
import { habitStats } from './habit';

const TODAY = '2026-08-18'; // a Tuesday

const DAILY: RecurrenceRule = {
  freq: 'daily',
  interval: 1,
  anchorMode: 'due_date',
  catchupPolicy: 'skip_to_future',
  endsMode: 'never',
};

/** Noon local on `day`, so the finish day cannot slip across midnight. */
function noon(day: PlainDate): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).toISOString();
}

function done(scheduled: PlainDate, finished = scheduled): Task {
  return { status: 'done', occurrenceDate: scheduled, completedAt: noon(finished) } as Task;
}

function open(scheduled: PlainDate): Task {
  return { status: 'active', occurrenceDate: scheduled, completedAt: null } as Task;
}

const day = (n: number) => addDays(TODAY, n);

describe('habitStats', () => {
  it('counts a daily run that reaches today', () => {
    const stats = habitStats(DAILY, [done(day(-3)), done(day(-2)), done(day(-1)), open(TODAY)], TODAY);
    expect(stats).toMatchObject({ current: 3, best: 3 });
    expect(stats.days).toHaveLength(28);
    expect(stats.days.at(-1)).toEqual({ date: TODAY, done: false });
    expect(stats.days.at(-2)).toEqual({ date: day(-1), done: true });
  });

  it('breaks on a skipped day and keeps the best run', () => {
    const stats = habitStats(
      DAILY,
      [done(day(-6)), done(day(-5)), done(day(-4)), done(day(-2)), done(day(-1)), open(TODAY)],
      TODAY,
    );
    expect(stats).toMatchObject({ current: 2, best: 3 });
  });

  it('drops to zero when the open occurrence was rolled past a missed day', () => {
    // Last done two days ago, and the open one sits on today after the roll.
    const stats = habitStats(DAILY, [done(day(-3)), done(day(-2)), open(TODAY)], TODAY);
    expect(stats).toMatchObject({ current: 0, best: 2 });
  });

  it('drops to zero when the open occurrence is late', () => {
    const stats = habitStats(
      { ...DAILY, catchupPolicy: 'keep_backlog' },
      [done(day(-3)), open(day(-2))],
      TODAY,
    );
    expect(stats.current).toBe(0);
  });

  it('counts weekly occurrences, not calendar days', () => {
    const weekly: RecurrenceRule = { ...DAILY, freq: 'weekly', byday: [1] };
    // Mondays 2026-07-27, 08-03, 08-10, 08-17, with the next on 08-24.
    const stats = habitStats(
      weekly,
      [done('2026-07-27'), done('2026-08-03'), done('2026-08-10'), done('2026-08-17'), open('2026-08-24')],
      TODAY,
    );
    expect(stats).toMatchObject({ current: 4, best: 4 });
  });

  it('steps a completion-anchored rule from the day it was finished', () => {
    const every3: RecurrenceRule = { ...DAILY, interval: 3, anchorMode: 'completion_date' };
    // Finished a day late each time, which the rule allows for.
    const stats = habitStats(
      every3,
      [done(day(-8), day(-7)), done(day(-4), day(-4)), open(day(-1))],
      TODAY,
    );
    expect(stats.best).toBe(2);
  });

  it('says nothing for a series with nothing finished', () => {
    expect(habitStats(DAILY, [open(TODAY)], TODAY)).toMatchObject({ current: 0, best: 0 });
  });
});
