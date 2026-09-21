import { describe, expect, it } from 'vitest';
import { NO_DUE_DAY, type Course, type CourseEvent, type Task } from '@/lib/db/types';
import { classesOn, examRadar, nextUp, whenLabel } from './upnext';

/** 2026-09-21 is a Monday. */
const TODAY = '2026-09-21';

let n = 0;
const course = (over: Partial<Course> = {}): Course => {
  n += 1;
  return {
    id: `course-${n}`,
    code: `C${n}`,
    status: 'active',
    meetings: [],
    ...over,
  } as unknown as Course;
};

const task = (courseId: string, due: string, over: Partial<Task> = {}): Task =>
  ({
    id: `task-${(n += 1)}`,
    courseId,
    _dueDay: due,
    _done: 0,
    parentTaskId: '',
    ...over,
  }) as unknown as Task;

describe('what each course wants next', () => {
  it('takes the soonest open deadline per course', () => {
    const a = course({ code: 'CS 6035' });
    const b = course({ code: 'MATH 6014' });
    const rows = nextUp(
      [a, b],
      [
        task(a.id, '2026-10-02'),
        task(a.id, '2026-09-24'),
        task(b.id, '2026-09-23'),
      ],
      TODAY,
    );

    // One row per course, soonest first. Five deadlines in one course is a list
    // you already have.
    expect(rows.map((row) => [row.course.code, row.task._dueDay, row.days])).toEqual([
      ['MATH 6014', '2026-09-23', 2],
      ['CS 6035', '2026-09-24', 3],
    ]);
  });

  it('counts an overdue deadline as negative', () => {
    const a = course();
    expect(nextUp([a], [task(a.id, '2026-09-18')], TODAY)[0]!.days).toBe(-3);
  });

  it('leaves out a course with nothing open', () => {
    // Padding the strip with courses that owe nothing makes the ones that do
    // harder to see.
    const a = course();
    const b = course();
    expect(nextUp([a, b], [task(a.id, '2026-09-24')], TODAY).map((r) => r.course.id)).toEqual([
      a.id,
    ]);
  });

  it('leaves out a finished course', () => {
    const done = course({ status: 'done' });
    expect(nextUp([done], [task(done.id, '2026-09-24')], TODAY)).toEqual([]);
  });

  it('ignores finished work, subtasks and undated work', () => {
    const a = course();
    const rows = nextUp(
      [a],
      [
        task(a.id, '2026-09-22', { _done: 1 }),
        task(a.id, '2026-09-23', { parentTaskId: 'parent' }),
        task(a.id, NO_DUE_DAY),
        task(a.id, '2026-09-30'),
      ],
      TODAY,
    );
    expect(rows[0]!.task._dueDay).toBe('2026-09-30');
  });

  it('caps the strip rather than listing a whole degree', () => {
    const courses = [course(), course(), course(), course(), course()];
    const tasks = courses.map((each, index) => task(each.id, `2026-09-2${index + 2}`));
    expect(nextUp(courses, tasks, TODAY, 3)).toHaveLength(3);
  });

  it('says when in words', () => {
    expect(whenLabel(0)).toBe('today');
    expect(whenLabel(1)).toBe('tomorrow');
    expect(whenLabel(4)).toBe('4 days');
    expect(whenLabel(-1)).toBe('1 day late');
    expect(whenLabel(-3)).toBe('3 days late');
  });
});

describe('the classes meeting today', () => {
  const monday = { byday: 1, start: '09:30', end: '10:45', location: 'Klaus 1116' };
  const tuesday = { byday: 2, start: '14:00', end: '15:15', location: '' };

  it('picks the weekday out of a weekly pattern', () => {
    const a = course({ meetings: [monday, tuesday] });
    expect(classesOn([a], TODAY).map((each) => each.start)).toEqual(['09:30']);
  });

  it('sorts the day earliest first, across courses', () => {
    const early = course({ meetings: [{ ...monday, start: '08:00' }] });
    const late = course({ meetings: [monday] });
    expect(classesOn([late, early], TODAY).map((each) => each.start)).toEqual(['08:00', '09:30']);
  });

  it('says nothing on a day nothing meets', () => {
    const a = course({ meetings: [tuesday] });
    expect(classesOn([a], TODAY)).toEqual([]);
  });

  it('leaves out a dropped course, whose timetable is not news', () => {
    const dropped = course({ status: 'dropped', meetings: [monday] });
    expect(classesOn([dropped], TODAY)).toEqual([]);
  });
});

describe('the exam radar', () => {
  const exam = (day: string, kind: CourseEvent['kind'] = 'exam') =>
    ({ id: `e-${(n += 1)}`, kind, startsOn: day, title: 'Exam' }) as unknown as CourseEvent;

  it('lists exams inside the window, soonest first', () => {
    const rows = examRadar([exam('2026-10-05'), exam('2026-09-30')], TODAY);
    expect(rows.map((row) => [row.event.startsOn, row.days])).toEqual([
      ['2026-09-30', 9],
      ['2026-10-05', 14],
    ]);
  });

  it('drops anything past the window, which is a date rather than a plan', () => {
    expect(examRadar([exam('2026-12-08')], TODAY)).toEqual([]);
  });

  it('drops an exam that has already happened', () => {
    expect(examRadar([exam('2026-09-14')], TODAY)).toEqual([]);
  });

  it('keeps one happening today', () => {
    expect(examRadar([exam(TODAY)], TODAY).map((r) => r.days)).toEqual([0]);
  });

  it('ignores a lecture, which is not an exam', () => {
    expect(examRadar([exam('2026-09-30', 'class')], TODAY)).toEqual([]);
  });
});
