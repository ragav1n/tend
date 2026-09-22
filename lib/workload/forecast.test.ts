import { describe, expect, it } from 'vitest';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import { dayFor, forecast, peakOf } from './forecast';

/** Four hours a day, Monday to Friday. 2026-09-21 is a Monday. */
const WEEKDAYS = { dailyMinutes: 240, workDays: [1, 2, 3, 4, 5] };

let n = 0;
function task(over: Partial<Task> = {}): Task {
  n += 1;
  return {
    id: `task-${n}`,
    _done: 0,
    _dueDay: NO_DUE_DAY,
    plannedFor: null,
    parentTaskId: '',
    estimateMinutes: null,
    ...over,
  } as unknown as Task;
}

const dayOf = (days: ReturnType<typeof forecast>, date: string) =>
  days.find((day) => day.date === date)!;

describe('which day a task counts against', () => {
  it('prefers the day you planned it for', () => {
    // The whole reason two date columns exist. A task due Friday and planned for
    // Tuesday is Tuesday's work, and loading Friday would tell you your Friday
    // is full when you had already dealt with it.
    expect(dayFor(task({ _dueDay: '2026-09-25', plannedFor: '2026-09-22' }))).toBe('2026-09-22');
  });

  it('falls back to the day it is owed', () => {
    expect(dayFor(task({ _dueDay: '2026-09-25' }))).toBe('2026-09-25');
  });

  it('belongs to no day when it has neither', () => {
    expect(dayFor(task())).toBeNull();
  });
});

describe('a day load', () => {
  it('adds up the estimates landing on it', () => {
    const days = forecast(
      [task({ _dueDay: '2026-09-22', estimateMinutes: 90 }), task({ _dueDay: '2026-09-22', estimateMinutes: 30 })],
      '2026-09-21',
      '2026-09-23',
      WEEKDAYS,
    );
    expect(dayOf(days, '2026-09-22')).toMatchObject({ minutes: 120, capacity: 240, tasks: 2 });
  });

  it('reads free, light, full and over off the capacity', () => {
    const load = (minutes: number) =>
      dayOf(
        forecast([task({ _dueDay: '2026-09-22', estimateMinutes: minutes })], '2026-09-22', '2026-09-22', WEEKDAYS),
        '2026-09-22',
      ).state;

    // A task estimated at nothing takes nothing, so the day is still free.
    expect(load(0)).toBe('free');
    expect(load(120)).toBe('light');
    expect(load(200)).toBe('full');
    expect(load(300)).toBe('over');
  });

  it('reads free for a day with nothing on it', () => {
    const days = forecast([], '2026-09-21', '2026-09-21', WEEKDAYS);
    expect(dayOf(days, '2026-09-21')).toMatchObject({ minutes: 0, state: 'free', tasks: 0 });
  });

  it('reads over for anything parked on a day you do not work', () => {
    // Visible rather than silently fine.
    const days = forecast(
      [task({ _dueDay: '2026-09-26', estimateMinutes: 30 })],
      '2026-09-26',
      '2026-09-26',
      WEEKDAYS,
    );
    expect(dayOf(days, '2026-09-26')).toMatchObject({ capacity: 0, state: 'over' });
  });

  it('counts an unestimated task without giving it minutes', () => {
    const days = forecast(
      [task({ _dueDay: '2026-09-22', estimateMinutes: null }), task({ _dueDay: '2026-09-22', estimateMinutes: 60 })],
      '2026-09-22',
      '2026-09-22',
      WEEKDAYS,
    );
    expect(dayOf(days, '2026-09-22')).toMatchObject({ minutes: 60, tasks: 2, unestimated: 1 });
  });

  it('covers every day in the range, loaded or not', () => {
    const days = forecast([], '2026-09-21', '2026-09-27', WEEKDAYS);
    expect(days).toHaveLength(7);
    expect(days.map((day) => day.capacity)).toEqual([240, 240, 240, 240, 240, 0, 0]);
  });

  it('ignores work outside the range', () => {
    const days = forecast(
      [task({ _dueDay: '2026-10-30', estimateMinutes: 600 })],
      '2026-09-21',
      '2026-09-23',
      WEEKDAYS,
    );
    expect(days.every((day) => day.minutes === 0)).toBe(true);
  });

  it('leaves finished work out and puts a part on its own day', () => {
    // The subtask's parent is elsewhere, which is the ordinary case. Dropped,
    // as it was until a subtask could hold its own date, the hour it takes
    // lands on no day at all.
    const days = forecast(
      [
        task({ _dueDay: '2026-09-22', estimateMinutes: 60, _done: 1 }),
        task({ _dueDay: '2026-09-22', estimateMinutes: 60, parentTaskId: 'elsewhere' }),
        task({ _dueDay: '2026-09-22', estimateMinutes: 60 }),
      ],
      '2026-09-22',
      '2026-09-22',
      WEEKDAYS,
    );
    expect(dayOf(days, '2026-09-22')).toMatchObject({ minutes: 120, tasks: 2 });
  });

  it('prices a parent through its parts rather than twice', () => {
    // The parent still counts as a task on its day, because it is still due
    // then. Its hours are on the days its parts are due.
    const days = forecast(
      [
        task({ id: 'parent', _dueDay: '2026-09-23', estimateMinutes: 360 }),
        task({ _dueDay: '2026-09-22', estimateMinutes: 180, parentTaskId: 'parent' }),
        task({ _dueDay: '2026-09-23', estimateMinutes: 180, parentTaskId: 'parent' }),
      ],
      '2026-09-22',
      '2026-09-23',
      WEEKDAYS,
    );

    expect(dayOf(days, '2026-09-22')).toMatchObject({ minutes: 180, tasks: 1 });
    expect(dayOf(days, '2026-09-23')).toMatchObject({ minutes: 180, tasks: 2 });
  });

  it('covers a parent from a part that is outside the window', () => {
    // Covering decided over the window alone would hand the parent's whole
    // figure back the moment its parts fell off the end of the strip.
    const days = forecast(
      [
        task({ id: 'whole', _dueDay: '2026-09-22', estimateMinutes: 600 }),
        task({ _dueDay: '2026-10-30', estimateMinutes: 600, parentTaskId: 'whole' }),
      ],
      '2026-09-22',
      '2026-09-23',
      WEEKDAYS,
    );

    expect(dayOf(days, '2026-09-22')).toMatchObject({ minutes: 0, tasks: 1, unestimated: 0 });
  });

  it('gives a strip something to scale by', () => {
    const days = forecast(
      [task({ _dueDay: '2026-09-22', estimateMinutes: 500 })],
      '2026-09-21',
      '2026-09-23',
      WEEKDAYS,
    );
    // The busiest day, or the capacity when nothing beats it.
    expect(peakOf(days)).toBe(500);
    expect(peakOf(forecast([], '2026-09-21', '2026-09-23', WEEKDAYS))).toBe(240);
    expect(peakOf([])).toBe(0);
  });
});
