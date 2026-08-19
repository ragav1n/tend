import { describe, expect, it } from 'vitest';
import { formatClock, formatDueLabel } from './date';

const TODAY = '2026-08-19';

describe('formatDueLabel', () => {
  it('names the days either side of today', () => {
    expect(formatDueLabel(TODAY, TODAY)).toBe('Today');
    expect(formatDueLabel('2026-08-20', TODAY)).toBe('Tomorrow');
    expect(formatDueLabel('2026-08-18', TODAY)).toBe('Yesterday');
  });

  it('uses the weekday inside the coming week', () => {
    expect(formatDueLabel('2026-08-21', TODAY, 'en-US')).toBe('Friday');
    expect(formatDueLabel('2026-08-24', TODAY, 'en-US')).toBe('Monday');
  });

  it('switches to a date past the week', () => {
    // The locale is pinned here and nowhere else: the app formats in the user's,
    // and the assertion is about which fields appear rather than their order.
    expect(formatDueLabel('2026-08-26', TODAY, 'en-US')).toBe('Aug 26');
    expect(formatDueLabel('2027-01-04', TODAY, 'en-US')).toBe('Jan 4');
  });

  it('counts back for anything overdue by more than a day', () => {
    expect(formatDueLabel('2026-08-16', TODAY)).toBe('3 days ago');
    expect(formatDueLabel('2026-07-20', TODAY)).toBe('30 days ago');
  });

  it('crosses a month and a DST boundary without drifting a day', () => {
    expect(formatDueLabel('2026-09-01', '2026-08-31')).toBe('Tomorrow');
    // US DST ends 2026-11-01. Both sides of it still read as one day apart.
    expect(formatDueLabel('2026-11-01', '2026-10-31')).toBe('Tomorrow');
    expect(formatDueLabel('2026-10-31', '2026-11-01')).toBe('Yesterday');
  });
});

describe('formatClock', () => {
  it('drops the minutes on the hour and keeps them otherwise', () => {
    expect(formatClock('09:00')).toBe('9am');
    expect(formatClock('09:05')).toBe('9:05am');
    expect(formatClock('13:30')).toBe('1:30pm');
  });

  it('handles both ends of the day', () => {
    expect(formatClock('00:00')).toBe('12am');
    expect(formatClock('12:00')).toBe('12pm');
    expect(formatClock('23:59')).toBe('11:59pm');
  });
});
