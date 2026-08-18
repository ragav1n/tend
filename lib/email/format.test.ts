import { describe, expect, it } from 'vitest';
import { formatDay, formatRelativeDay, formatTime, formatWhen, plural } from './format';

/**
 * Formatting for email, which is all wall clock.
 *
 * Every value here already arrived converted: Postgres did the timezone work when
 * it generated the delivery. So the one thing these have to not do is convert
 * anything a second time, which is why nothing here touches Intl or a Date with a
 * local offset.
 */

describe('days', () => {
  it('reads a date as a calendar day, not an instant', () => {
    // Parsed at UTC on purpose. Treating it as local would turn this into
    // 31 Aug for anybody west of Greenwich.
    expect(formatDay('2026-09-01')).toBe('Tue 1 Sep');
    expect(formatDay('2026-12-25')).toBe('Fri 25 Dec');
  });

  it('says today, tomorrow and yesterday relative to the reader', () => {
    expect(formatRelativeDay('2026-09-01', '2026-09-01')).toBe('today');
    expect(formatRelativeDay('2026-09-02', '2026-09-01')).toBe('tomorrow');
    expect(formatRelativeDay('2026-08-31', '2026-09-01')).toBe('yesterday');
    expect(formatRelativeDay('2026-08-25', '2026-09-01')).toBe('7 days ago');
    expect(formatRelativeDay('2026-09-05', '2026-09-01')).toBe('Sat 5 Sep');
  });
});

describe('times', () => {
  it('turns a Postgres time into something a person reads', () => {
    expect(formatTime('18:00:00')).toBe('6:00 pm');
    expect(formatTime('09:05:00')).toBe('9:05 am');
    expect(formatTime('00:30:00')).toBe('12:30 am');
    expect(formatTime('12:00:00')).toBe('12:00 pm');
  });

  it('drops the time from an all-day task', () => {
    expect(formatWhen('2026-09-01', null)).toBe('Tue 1 Sep');
    expect(formatWhen('2026-09-01', '18:00:00')).toBe('Tue 1 Sep at 6:00 pm');
  });
});

describe('counting', () => {
  it('pluralises in one place so no subject line gets it wrong', () => {
    expect(plural(1, 'task')).toBe('1 task');
    expect(plural(3, 'task')).toBe('3 tasks');
    expect(plural(0, 'task')).toBe('0 tasks');
  });
});
