import { describe, expect, it } from 'vitest';
import {
  addDays,
  capacityBetween,
  capacityOf,
  daysBetween,
  formatWorkMinutes,
  isoDayOf,
} from './capacity';

/** Four hours a day, Monday to Friday. */
const WEEKDAYS = { dailyMinutes: 240, workDays: [1, 2, 3, 4, 5] };

describe('an ISO weekday', () => {
  it('reads Monday as 1 and Sunday as 7', () => {
    // 2026-09-21 is a Monday.
    expect(isoDayOf('2026-09-21')).toBe(1);
    expect(isoDayOf('2026-09-27')).toBe(7);
  });

  it('reads the date as UTC rather than through the device', () => {
    // A wall-clock date has no zone. Letting an offset decide would make a
    // Sunday in Auckland a Saturday in Atlanta and shift somebody's week.
    expect(isoDayOf('2026-01-01')).toBe(4);
  });
});

describe('walking days', () => {
  it('crosses a month end', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('crosses a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('goes backwards too', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('lists an inclusive range', () => {
    expect(daysBetween('2026-09-21', '2026-09-23')).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ]);
  });

  it('lists one day for a range of one', () => {
    expect(daysBetween('2026-09-21', '2026-09-21')).toEqual(['2026-09-21']);
  });

  it('lists nothing when the end is before the start', () => {
    expect(daysBetween('2026-09-23', '2026-09-21')).toEqual([]);
  });
});

describe('how much a stretch holds', () => {
  it('gives a work day its minutes and a weekend none', () => {
    expect(capacityOf('2026-09-21', WEEKDAYS)).toBe(240);
    expect(capacityOf('2026-09-26', WEEKDAYS)).toBe(0);
  });

  it('adds up a working week', () => {
    // Monday to Friday, five days at four hours.
    expect(capacityBetween('2026-09-21', '2026-09-25', WEEKDAYS)).toBe(1200);
  });

  it('skips the weekend inside a longer run', () => {
    // Monday the 21st to Monday the 28th is six work days, not eight.
    expect(capacityBetween('2026-09-21', '2026-09-28', WEEKDAYS)).toBe(1440);
  });

  it('counts a weekend for somebody who works one', () => {
    const sundays = { dailyMinutes: 120, workDays: [1, 2, 3, 4, 5, 7] };
    expect(capacityBetween('2026-09-26', '2026-09-27', sundays)).toBe(120);
  });

  it('holds nothing for a day already past', () => {
    // The overdue case, and the reason slack comes out negative rather than
    // merely small.
    expect(capacityBetween('2026-09-21', '2026-09-18', WEEKDAYS)).toBe(0);
  });

  it('holds nothing for somebody who works no days', () => {
    expect(capacityBetween('2026-09-21', '2026-09-25', { dailyMinutes: 240, workDays: [] })).toBe(0);
  });
});

describe('minutes as words', () => {
  it('reads minutes under an hour', () => {
    expect(formatWorkMinutes(45)).toBe('45m');
  });

  it('reads whole hours without a stray zero', () => {
    // The bug this function exists for: `formatMinutes` in lib/focus/timer.ts
    // takes seconds despite its name, so a four hour day rendered as "4m".
    expect(formatWorkMinutes(240)).toBe('4h');
  });

  it('reads hours and minutes together', () => {
    expect(formatWorkMinutes(150)).toBe('2h 30m');
  });

  it('reads nothing as zero rather than as empty', () => {
    expect(formatWorkMinutes(0)).toBe('0m');
  });
});
