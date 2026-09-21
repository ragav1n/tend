import { describe, expect, it } from 'vitest';
import type { Course, FocusSession, Task } from '@/lib/db/types';
import { academicWeek } from './academic';

let n = 0;
const course = (over: Partial<Course> = {}): Course =>
  ({ id: `course-${(n += 1)}`, code: `C${n}`, status: 'active', ...over }) as unknown as Course;

const task = (id: string, courseId: string, over: Partial<Task> = {}): Task =>
  ({ id, courseId, pointsEarned: null, pointsPossible: null, ...over }) as unknown as Task;

const session = (taskId: string, seconds: number): FocusSession =>
  ({ id: `s-${(n += 1)}`, taskId, focusedSeconds: seconds }) as unknown as FocusSession;

describe('the week read through your courses', () => {
  it('attributes focus time through the task a session named', () => {
    const a = course({ code: 'CS 6035' });
    const b = course({ code: 'MATH 6014' });
    const tasks = [task('t1', a.id), task('t2', b.id)];

    const out = academicWeek([a, b], [], [session('t1', 3600), session('t2', 600)], tasks, []);
    expect(out.courses.map((row) => [row.course.code, row.focusedSeconds])).toEqual([
      ['CS 6035', 3600],
      ['MATH 6014', 600],
    ]);
  });

  it('says how much time it could not place rather than spreading it', () => {
    // A session with no task attached is real work nobody can honestly assign.
    const a = course();
    const out = academicWeek([a], [], [session('', 1800), session('t1', 600)], [task('t1', a.id)], []);
    expect(out.unattributedSeconds).toBe(1800);
    expect(out.courses[0]!.focusedSeconds).toBe(600);
  });

  it('places a session whose task was finished in an earlier week', () => {
    // `allTasks` exists for exactly this: the session is in the week, the task
    // is not, and the course link is on the task.
    const a = course();
    const out = academicWeek([a], [], [session('old', 900)], [task('old', a.id)], []);
    expect(out.courses[0]!.focusedSeconds).toBe(900);
    expect(out.unattributedSeconds).toBe(0);
  });

  it('counts what was finished and what was graded, separately', () => {
    const a = course();
    const out = academicWeek(
      [a],
      [task('done1', a.id), task('done2', a.id)],
      [],
      [],
      [task('g1', a.id, { pointsEarned: 78, pointsPossible: 100 })],
    );
    expect(out.courses[0]).toMatchObject({ finished: 2, earned: 78, possible: 100 });
  });

  it('ignores a graded task with only half its marks', () => {
    const a = course();
    const out = academicWeek([a], [], [], [], [task('g', a.id, { pointsEarned: 50 })]);
    expect(out.courses).toEqual([]);
  });

  it('leaves out a course with a blank week', () => {
    // Rows of zeroes bury the interesting reading, which is where time went.
    const busy = course();
    const quiet = course();
    const out = academicWeek([busy, quiet], [], [session('t', 60)], [task('t', busy.id)], []);
    expect(out.courses.map((row) => row.course.id)).toEqual([busy.id]);
  });

  it('ignores work belonging to no course', () => {
    const a = course();
    const out = academicWeek([a], [task('x', '')], [session('x', 600)], [task('x', '')], []);
    expect(out.courses).toEqual([]);
    expect(out.unattributedSeconds).toBe(600);
  });

  it('answers empty for a week with nothing in it', () => {
    expect(academicWeek([], [], [], [], [])).toEqual({ courses: [], unattributedSeconds: 0 });
  });
});
