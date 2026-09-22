import { describe, expect, it } from 'vitest';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import { firstOverdrawn, slackByDay, slackFor } from './slack';

/** Four hours a day, Monday to Friday. 2026-09-21 is a Monday. */
const WEEKDAYS = { dailyMinutes: 240, workDays: [1, 2, 3, 4, 5] };
const MONDAY = '2026-09-21';

let n = 0;
function task(over: Partial<Task> = {}): Task {
  n += 1;
  return {
    id: `task-${n}`,
    _done: 0,
    _dueDay: NO_DUE_DAY,
    parentTaskId: '',
    estimateMinutes: null,
    ...over,
  } as unknown as Task;
}

/** Due on a day, with an estimate in minutes. */
const due = (day: string, minutes: number | null) =>
  task({ _dueDay: day, estimateMinutes: minutes });

describe('slack for a day', () => {
  it('is the room left after everything owed by then', () => {
    // Monday to Wednesday is 720 minutes. 300 committed leaves 420.
    const byDay = slackByDay([due('2026-09-23', 300)], MONDAY, WEEKDAYS);
    expect(byDay.get('2026-09-23')).toMatchObject({
      capacity: 720,
      committed: 300,
      slack: 420,
    });
  });

  it('counts everything due on or before the day, not just that day', () => {
    // Two tasks due Tuesday and Wednesday compete for the same hours.
    const byDay = slackByDay(
      [due('2026-09-22', 200), due('2026-09-23', 200)],
      MONDAY,
      WEEKDAYS,
    );
    expect(byDay.get('2026-09-22')!.committed).toBe(200);
    expect(byDay.get('2026-09-23')!.committed).toBe(400);
  });

  it('goes negative when the work owed does not fit', () => {
    // Monday and Tuesday hold 480. Owing 600 by Tuesday is 120 short, and that
    // is knowable on Monday rather than on Tuesday night.
    const byDay = slackByDay([due('2026-09-22', 600)], MONDAY, WEEKDAYS);
    expect(byDay.get('2026-09-22')!.slack).toBe(-120);
  });

  it('gives two tasks due the same day one shared figure', () => {
    // Correct rather than a simplification: they are competing for the same
    // hours, so there is one answer about that day.
    const a = due('2026-09-23', 400);
    const b = due('2026-09-23', 400);
    const byDay = slackByDay([a, b], MONDAY, WEEKDAYS);
    expect(slackFor(a, byDay)).toBe(slackFor(b, byDay));
    expect(slackFor(a, byDay)!.slack).toBe(720 - 800);
  });

  it('drags the whole run negative for overdue work', () => {
    // An overdue task gets no capacity window of its own and counts against
    // every future day. It is not a task with a little slack left.
    const byDay = slackByDay([due('2026-09-18', 120), due('2026-09-25', 60)], MONDAY, WEEKDAYS);
    expect(byDay.get('2026-09-18')!.slack).toBe(-120);
    // Monday to Friday is 1200, owing 180 by Friday.
    expect(byDay.get('2026-09-25')!.slack).toBe(1020);
  });

  it('counts an unestimated task without inventing a duration', () => {
    // A blank estimate contributes nothing and is counted, so the figure can be
    // read for what it is worth instead of looking confident.
    const byDay = slackByDay([due('2026-09-23', null), due('2026-09-23', 60)], MONDAY, WEEKDAYS);
    expect(byDay.get('2026-09-23')).toMatchObject({ committed: 60, unestimated: 1 });
  });

  it('skips a weekend, which is what makes a Monday deadline tight', () => {
    // Friday to the next Monday is two work days, not four.
    const byDay = slackByDay([due('2026-09-28', 600)], '2026-09-25', WEEKDAYS);
    expect(byDay.get('2026-09-28')!.capacity).toBe(480);
    expect(byDay.get('2026-09-28')!.slack).toBe(-120);
  });

  it('leaves finished work out', () => {
    const byDay = slackByDay([due('2026-09-23', 900), task({ _dueDay: '2026-09-23', estimateMinutes: 900, _done: 1 })], MONDAY, WEEKDAYS);
    expect(byDay.get('2026-09-23')!.committed).toBe(900);
  });

  it('counts a part against its own deadline', () => {
    // Its parent is not in this window at all, which is the ordinary case: a
    // chapter due Wednesday inside a thesis due next month. Skipped, as it was
    // until a subtask could hold its own date, those five hours are owed by
    // Wednesday and appear nowhere.
    const byDay = slackByDay(
      [
        due('2026-09-23', 300),
        task({ _dueDay: '2026-09-23', estimateMinutes: 300, parentTaskId: 'elsewhere' }),
      ],
      MONDAY,
      WEEKDAYS,
    );
    expect(byDay.get('2026-09-23')!.committed).toBe(600);
  });

  it('prices a parent through its parts rather than twice', () => {
    // Nine hours broken into three threes is nine hours of work. The parent's
    // own figure is the same work priced whole, so counting both is eighteen.
    const parent = task({ id: 'parent', _dueDay: '2026-09-25', estimateMinutes: 540 });
    const byDay = slackByDay(
      [
        parent,
        task({ _dueDay: '2026-09-23', estimateMinutes: 180, parentTaskId: 'parent' }),
        task({ _dueDay: '2026-09-24', estimateMinutes: 180, parentTaskId: 'parent' }),
        task({ _dueDay: '2026-09-25', estimateMinutes: 180, parentTaskId: 'parent' }),
      ],
      MONDAY,
      WEEKDAYS,
    );

    expect(byDay.get('2026-09-25')!.committed).toBe(540);
  });

  it('does not call a parent unestimated when its parts carry the numbers', () => {
    // The count beside a figure says how much of it was guessed at. A parent
    // priced by its parts was guessed at nowhere.
    const parent = task({ id: 'whole', _dueDay: '2026-09-25' });
    const byDay = slackByDay(
      [parent, task({ _dueDay: '2026-09-23', estimateMinutes: 180, parentTaskId: 'whole' })],
      MONDAY,
      WEEKDAYS,
    );

    expect(byDay.get('2026-09-25')).toMatchObject({ committed: 180, unestimated: 0 });
  });

  it('has nothing to say about an undated task', () => {
    const parked = task({ estimateMinutes: 600 });
    const byDay = slackByDay([parked], MONDAY, WEEKDAYS);
    expect(byDay.size).toBe(0);
    expect(slackFor(parked, byDay)).toBeNull();
  });

  it('answers an empty list with an empty map', () => {
    expect(slackByDay([], MONDAY, WEEKDAYS).size).toBe(0);
  });

  it('keeps the running total right however the tasks arrive', () => {
    // The pass up the sorted days carries a running commitment, so an unsorted
    // input has to give the same answer as a sorted one.
    const tasks = [due('2026-09-25', 100), due('2026-09-22', 100), due('2026-09-23', 100)];
    const forward = slackByDay(tasks, MONDAY, WEEKDAYS);
    const backward = slackByDay([...tasks].reverse(), MONDAY, WEEKDAYS);
    for (const day of ['2026-09-22', '2026-09-23', '2026-09-25']) {
      expect(forward.get(day)!.committed, day).toBe(backward.get(day)!.committed);
    }
    expect(forward.get('2026-09-25')!.committed).toBe(300);
  });
});

describe('the first day that stopped working', () => {
  it('names the earliest overdrawn day', () => {
    const byDay = slackByDay(
      [due('2026-09-22', 100), due('2026-09-23', 2000), due('2026-09-25', 100)],
      MONDAY,
      WEEKDAYS,
    );
    expect(firstOverdrawn(byDay)!.date).toBe('2026-09-23');
  });

  it('answers nothing when everything fits', () => {
    const byDay = slackByDay([due('2026-09-25', 60)], MONDAY, WEEKDAYS);
    expect(firstOverdrawn(byDay)).toBeNull();
  });
});
