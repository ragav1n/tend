import { describe, expect, it } from 'vitest';
import {
  formatDay,
  formatDuration,
  formatRelativeDay,
  formatTime,
  formatWhen,
  plural,
  taskMeta,
  weekdayInitial,
} from './format';

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

  it('reads a duration in hours once it stops being minutes', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(150)).toBe('2h 30m');
  });

  it('names the weekday for a chart column', () => {
    expect(weekdayInitial('2026-09-01')).toBe('Tue');
    expect(weekdayInitial('2026-08-30')).toBe('Sun');
  });
});

describe('the small print under a title', () => {
  const task = {
    project: 'Garden',
    waiting: true,
    repeats: true,
    estimate: 90,
    tags: ['home', 'slow'],
    subtasks: { done: 1, total: 4 },
  };

  it('orders it the way it reads', () => {
    expect(taskMeta(task)).toEqual([
      'waiting',
      'Garden',
      '1 of 4 done',
      '1h 30m',
      'repeats',
      '#home',
      '#slow',
    ]);
  });

  it('says nothing about a task that has nothing to say', () => {
    // A payload frozen before 0013 has none of these fields, and the template
    // drops the line rather than printing a lonely separator.
    expect(taskMeta({ project: null })).toEqual([]);
  });

  it('leaves out a subtask count nobody has started counting', () => {
    expect(taskMeta({ project: null, subtasks: { done: 0, total: 0 } })).toEqual([]);
    expect(taskMeta({ project: null, estimate: 0 })).toEqual([]);
  });
});
