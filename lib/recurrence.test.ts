import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysInMonth,
  describeRule,
  isoDow,
  nextOccurrence,
  nthWeekdayOfMonth,
  stepOnce,
  type RecurrenceRule,
} from './recurrence';

function rule(over: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    freq: 'daily',
    interval: 1,
    anchorMode: 'due_date',
    catchupPolicy: 'skip_to_future',
    endsMode: 'never',
    ...over,
  };
}

describe('calendar helpers', () => {
  it('reports ISO day of week with Monday as 1', () => {
    expect(isoDow('2026-08-17')).toBe(1); // Monday
    expect(isoDow('2026-08-23')).toBe(7); // Sunday
  });

  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('finds the nth weekday of a month', () => {
    // August 2026: the 1st is a Saturday, so the first Tuesday is the 4th.
    expect(nthWeekdayOfMonth(2026, 8, 2, 1)).toBe('2026-08-04');
    expect(nthWeekdayOfMonth(2026, 8, 2, 3)).toBe('2026-08-18');
    expect(nthWeekdayOfMonth(2026, 8, 2, -1)).toBe('2026-08-25');
  });

  it('returns null when a month has no nth weekday', () => {
    // February 2026 has exactly four Tuesdays, so there is no fifth.
    expect(nthWeekdayOfMonth(2026, 2, 2, 5)).toBeNull();
  });
});

describe('DST cannot move a date', () => {
  it('crosses spring forward without losing a day', () => {
    // US DST began 2026-03-08. Pure calendar arithmetic must not care.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('crosses autumn back without repeating a day', () => {
    // US DST ended 2026-11-01.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('keeps a daily rule on the same calendar cadence through a transition', () => {
    let d = '2026-03-05';
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      d = stepOnce(rule({ freq: 'daily' }), d)!;
      seen.push(d);
    }
    expect(seen).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
    ]);
  });
});

describe('daily', () => {
  it('steps by the interval', () => {
    expect(stepOnce(rule({ freq: 'daily', interval: 1 }), '2026-08-18')).toBe('2026-08-19');
    expect(stepOnce(rule({ freq: 'daily', interval: 3 }), '2026-08-18')).toBe('2026-08-21');
  });

  it('crosses a month boundary', () => {
    expect(stepOnce(rule({ freq: 'daily', interval: 1 }), '2026-08-31')).toBe('2026-09-01');
  });

  it('crosses a year boundary', () => {
    expect(stepOnce(rule({ freq: 'daily', interval: 2 }), '2026-12-31')).toBe('2027-01-02');
  });
});

describe('weekly', () => {
  it('finds the next listed weekday', () => {
    // 2026-08-18 is a Tuesday. Next Monday or Thursday is Thursday the 20th.
    const r = rule({ freq: 'weekly', byday: [1, 4] });
    expect(stepOnce(r, '2026-08-18')).toBe('2026-08-20');
  });

  it('wraps to the following week after the last listed day', () => {
    const r = rule({ freq: 'weekly', byday: [1, 4] });
    // Thursday the 20th, so next is Monday the 24th.
    expect(stepOnce(r, '2026-08-20')).toBe('2026-08-24');
  });

  it('keeps every-other-week aligned to the original fortnight', () => {
    // The bug this guards: naive stepping slides a fortnightly task forward by a
    // week each time, so "every other Tuesday" drifts into "every Tuesday".
    const r = rule({ freq: 'weekly', interval: 2, byday: [2] });
    let d = '2026-08-04'; // a Tuesday
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      d = stepOnce(r, d)!;
      seen.push(d);
    }
    expect(seen).toEqual(['2026-08-18', '2026-09-01', '2026-09-15', '2026-09-29']);
    for (const date of seen) expect(isoDow(date)).toBe(2);
  });

  it('defaults to the anchor weekday when byday is absent', () => {
    expect(stepOnce(rule({ freq: 'weekly' }), '2026-08-18')).toBe('2026-08-25');
  });
});

describe('monthly', () => {
  it('steps by month on the same day number', () => {
    expect(stepOnce(rule({ freq: 'monthly' }), '2026-08-15')).toBe('2026-09-15');
  });

  it('handles the last day of the month', () => {
    const r = rule({ freq: 'monthly', bymonthday: [-1] });
    expect(stepOnce(r, '2026-01-31')).toBe('2026-02-28');
    expect(stepOnce(r, '2026-02-28')).toBe('2026-03-31');
    expect(stepOnce(r, '2028-01-31')).toBe('2028-02-29');
  });

  it('skips months that lack the requested day rather than clamping', () => {
    // A rule of "the 31st" simply does not occur in a 30-day month. Clamping to
    // the 30th would silently invent an occurrence the user never asked for.
    const r = rule({ freq: 'monthly', bymonthday: [31] });
    expect(stepOnce(r, '2026-08-31')).toBe('2026-10-31');
  });

  it('handles the nth weekday of the month', () => {
    const r = rule({ freq: 'monthly', monthWeek: 3, byday: [2] });
    expect(stepOnce(r, '2026-08-18')).toBe('2026-09-15');
  });

  it('handles the last weekday of the month', () => {
    const r = rule({ freq: 'monthly', monthWeek: -1, byday: [5] });
    // Last Friday of September 2026 is the 25th.
    expect(stepOnce(r, '2026-08-28')).toBe('2026-09-25');
  });
});

describe('yearly', () => {
  it('steps by year', () => {
    expect(stepOnce(rule({ freq: 'yearly' }), '2026-08-18')).toBe('2027-08-18');
  });

  it('skips non-leap years for a 29 February rule', () => {
    const r = rule({ freq: 'yearly', bymonth: [2], bymonthday: [29] });
    expect(stepOnce(r, '2028-02-29')).toBe('2032-02-29');
  });
});

describe('anchor mode', () => {
  it('due_date keeps the schedule when a task is completed late', () => {
    // Weekly Monday task. Scheduled Monday the 10th, actually done Wednesday
    // the 19th. Next must still be a Monday, not "a week from Wednesday".
    const result = nextOccurrence({
      rule: rule({ freq: 'weekly', byday: [1] }),
      occurrenceDate: '2026-08-10',
      completedOn: '2026-08-19',
      today: '2026-08-19',
      completedCount: 0,
    });
    expect(result).toEqual({ kind: 'next', date: '2026-08-24', skipped: 1 });
    expect(isoDow('2026-08-24')).toBe(1);
  });

  it('completion_date pushes the series out when a task is completed late', () => {
    // "Water the plants every 3 days" means 3 days after you actually watered.
    const result = nextOccurrence({
      rule: rule({ freq: 'daily', interval: 3, anchorMode: 'completion_date' }),
      occurrenceDate: '2026-08-10',
      completedOn: '2026-08-19',
      today: '2026-08-19',
      completedCount: 0,
    });
    expect(result).toEqual({ kind: 'next', date: '2026-08-22', skipped: 0 });
  });

  it('completion_date ignores how stale the scheduled date was', () => {
    const result = nextOccurrence({
      rule: rule({ freq: 'daily', interval: 2, anchorMode: 'completion_date' }),
      occurrenceDate: '2020-01-01',
      completedOn: '2026-08-18',
      today: '2026-08-18',
      completedCount: 0,
    });
    expect(result).toEqual({ kind: 'next', date: '2026-08-20', skipped: 0 });
  });
});

describe('catch-up', () => {
  it('skip_to_future lands past today and reports what it skipped', () => {
    // Daily task untouched for a week. One step would still be in the past.
    const result = nextOccurrence({
      rule: rule({ freq: 'daily', catchupPolicy: 'skip_to_future' }),
      occurrenceDate: '2026-08-11',
      completedOn: '2026-08-18',
      today: '2026-08-18',
      completedCount: 0,
    });
    // 08-12 through 08-18 is seven occurrences passed over.
    expect(result).toEqual({ kind: 'next', date: '2026-08-19', skipped: 7 });
  });

  it('keep_backlog emits the immediate next occurrence even in the past', () => {
    const result = nextOccurrence({
      rule: rule({ freq: 'daily', catchupPolicy: 'keep_backlog' }),
      occurrenceDate: '2026-08-11',
      completedOn: '2026-08-18',
      today: '2026-08-18',
      completedCount: 0,
    });
    expect(result).toEqual({ kind: 'next', date: '2026-08-12', skipped: 0 });
  });

  it('never returns today itself, since the task was just completed', () => {
    const result = nextOccurrence({
      rule: rule({ freq: 'daily' }),
      occurrenceDate: '2026-08-17',
      completedOn: '2026-08-18',
      today: '2026-08-18',
      completedCount: 0,
    });
    expect(result).toEqual({ kind: 'next', date: '2026-08-19', skipped: 1 });
  });

  it('terminates on a series abandoned for years instead of spinning', () => {
    const result = nextOccurrence({
      rule: rule({ freq: 'daily' }),
      occurrenceDate: '2020-01-01',
      completedOn: '2026-08-18',
      today: '2026-08-18',
      completedCount: 0,
    });
    expect(result.kind).toBe('next');
    if (result.kind === 'next') expect(result.date > '2026-08-18').toBe(true);
  });
});

describe('end conditions', () => {
  it('ends after a fixed count', () => {
    const r = rule({ endsMode: 'after_count', endsAfterCount: 5 });
    expect(
      nextOccurrence({
        rule: r,
        occurrenceDate: '2026-08-18',
        completedOn: '2026-08-18',
        today: '2026-08-18',
        completedCount: 3,
      }).kind,
    ).toBe('next');

    expect(
      nextOccurrence({
        rule: r,
        occurrenceDate: '2026-08-18',
        completedOn: '2026-08-18',
        today: '2026-08-18',
        completedCount: 4,
      }),
    ).toEqual({ kind: 'ended', reason: 'after_count' });
  });

  it('ends on a date', () => {
    const r = rule({ endsMode: 'on_date', endsOn: '2026-08-20' });
    expect(
      nextOccurrence({
        rule: r,
        occurrenceDate: '2026-08-18',
        completedOn: '2026-08-18',
        today: '2026-08-18',
        completedCount: 0,
      }),
    ).toEqual({ kind: 'next', date: '2026-08-19', skipped: 0 });

    expect(
      nextOccurrence({
        rule: r,
        occurrenceDate: '2026-08-20',
        completedOn: '2026-08-20',
        today: '2026-08-20',
        completedCount: 0,
      }),
    ).toEqual({ kind: 'ended', reason: 'on_date' });
  });

  it('checks the count before generating, so a finished series adds no extra row', () => {
    const r = rule({ endsMode: 'after_count', endsAfterCount: 1 });
    expect(
      nextOccurrence({
        rule: r,
        occurrenceDate: '2026-08-18',
        completedOn: '2026-08-18',
        today: '2026-08-18',
        completedCount: 0,
      }),
    ).toEqual({ kind: 'ended', reason: 'after_count' });
  });
});

describe('describeRule', () => {
  it('reads as English', () => {
    expect(describeRule(rule({ freq: 'daily' }))).toBe('Every day');
    expect(describeRule(rule({ freq: 'daily', interval: 3 }))).toBe('Every 3 days');
    expect(describeRule(rule({ freq: 'weekly', byday: [1, 4] }))).toBe(
      'Every week on Monday, Thursday',
    );
    expect(describeRule(rule({ freq: 'monthly', monthWeek: 3, byday: [2] }))).toBe(
      'Every month on the 3rd Tuesday',
    );
    expect(describeRule(rule({ freq: 'monthly', bymonthday: [-1] }))).toBe(
      'Every month on day last',
    );
    expect(
      describeRule(rule({ freq: 'daily', interval: 3, anchorMode: 'completion_date' })),
    ).toBe('3 days after completion');
    expect(describeRule(rule({ freq: 'yearly' }))).toBe('Every year');
  });
});
