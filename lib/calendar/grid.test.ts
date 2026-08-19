import { describe, expect, it } from 'vitest';
import {
  DAYS_IN_WEEK,
  WEEKS_IN_GRID,
  gridRange,
  gridStart,
  groupByDate,
  isoDayOfWeek,
  monthGrid,
  monthLabel,
  monthOf,
  shiftDays,
  shiftMonth,
  weekdayLabels,
} from './grid';

describe('date helpers', () => {
  it('reports ISO day of week with Monday as 1', () => {
    expect(isoDayOfWeek('2026-08-17')).toBe(1);
    expect(isoDayOfWeek('2026-08-23')).toBe(7);
  });

  it('steps days across a month and a year boundary', () => {
    expect(shiftDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('steps whole months without landing in the wrong one', () => {
    expect(shiftMonth('2026-01', 1)).toBe('2026-02');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });

  it('reads the month off a date', () => {
    expect(monthOf('2026-08-20')).toBe('2026-08');
  });
});

describe('grid start', () => {
  it('starts on the week containing the first, for a Monday week', () => {
    // 2026-08-01 is a Saturday, so a Monday-first grid starts on July 27th.
    expect(gridStart('2026-08', 1)).toBe('2026-07-27');
  });

  it('respects a Sunday week start', () => {
    expect(gridStart('2026-08', 7)).toBe('2026-07-26');
  });

  it('starts on the first itself when the first is the week start', () => {
    // 2026-06-01 is a Monday.
    expect(gridStart('2026-06', 1)).toBe('2026-06-01');
  });
});

describe('monthGrid', () => {
  it('is always six rows of seven, so the view never changes height', () => {
    for (const month of ['2026-02', '2026-08', '2027-05', '2028-02']) {
      const weeks = monthGrid(month, 1);
      expect(weeks).toHaveLength(WEEKS_IN_GRID);
      for (const week of weeks) expect(week).toHaveLength(DAYS_IN_WEEK);
    }
  });

  it('runs consecutive days with no gaps', () => {
    const dates = monthGrid('2026-08', 1).flat().map((d) => d.date);
    for (let i = 1; i < dates.length; i += 1) {
      expect(dates[i]).toBe(shiftDays(dates[i - 1]!, 1));
    }
  });

  it('marks borrowed days from the neighbouring months', () => {
    const cells = monthGrid('2026-08', 1).flat();
    expect(cells[0]).toEqual({ date: '2026-07-27', day: 27, inMonth: false });
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(cells.at(-1)!.inMonth).toBe(false);
  });

  it('covers a February that starts on the week start exactly', () => {
    // 2027-02-01 is a Monday: the month fits in four rows, and the grid still
    // shows six, which is the whole point of the fixed height.
    const cells = monthGrid('2027-02', 1).flat();
    expect(cells[0]!.date).toBe('2027-02-01');
    expect(cells).toHaveLength(42);
    expect(cells.at(-1)!.date).toBe('2027-03-14');
  });

  it('reports the range it shows', () => {
    expect(gridRange('2026-08', 1)).toEqual({ from: '2026-07-27', to: '2026-09-06' });
  });
});

describe('labels', () => {
  it('rotates weekday headings to the week start', () => {
    expect(weekdayLabels(1, 'en-US')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels(7, 'en-US')).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(weekdayLabels(6, 'en-US')[0]).toBe('Sat');
  });

  it('names the month', () => {
    expect(monthLabel('2026-08', 'en-US')).toBe('August 2026');
    expect(monthLabel('2027-01', 'en-US')).toBe('January 2027');
  });
});

describe('groupByDate', () => {
  it('buckets rows and keeps the order they arrived in', () => {
    const rows = [
      { id: 'a', day: '2026-08-20' },
      { id: 'b', day: '2026-08-21' },
      { id: 'c', day: '2026-08-20' },
    ];
    const grouped = groupByDate(rows, (r) => r.day);
    expect(grouped.get('2026-08-20')!.map((r) => r.id)).toEqual(['a', 'c']);
    expect(grouped.get('2026-08-21')!.map((r) => r.id)).toEqual(['b']);
    expect(grouped.has('2026-08-22')).toBe(false);
  });
});
