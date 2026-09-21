import type { Course, FocusSession, Task } from '@/lib/db/types';

/**
 * The week, read through your courses.
 *
 * The existing Review answers "what did I finish and for how long". This
 * answers the same week per course, which is the version a student can act on:
 * four hours of focus means nothing until you know three of them went to one
 * class and none to the one you are behind on.
 *
 * Both halves are deliberately narrow. Focus time is attributed only through a
 * session that named a task, because a session with no task attached is real
 * work that nobody can honestly assign. Points are counted only where they were
 * actually graded this week. Neither number guesses.
 */

export interface CourseWeek {
  course: Course;
  /** Seconds focused on tasks belonging to this course. */
  focusedSeconds: number;
  /** Tasks finished this week. */
  finished: number;
  /** Points earned and available across work graded this week. */
  earned: number;
  possible: number;
}

export interface AcademicWeek {
  courses: CourseWeek[];
  /** Focus seconds in sessions attached to no task, so the total can be honest
   *  about how much of itself it cannot place. */
  unattributedSeconds: number;
}

export function academicWeek(
  courses: readonly Course[],
  /** Tasks completed inside the week. */
  completed: readonly Task[],
  /** Sessions started inside the week. */
  sessions: readonly FocusSession[],
  /** Every task carrying a course, so a session can find its course even when
   *  the task it names was finished in another week. */
  allTasks: readonly Task[],
  /** Tasks whose grade landed inside the week. */
  graded: readonly Task[],
): AcademicWeek {
  const courseOf = new Map(allTasks.map((task) => [task.id, task.courseId]));

  const focused = new Map<string, number>();
  let unattributedSeconds = 0;

  for (const session of sessions) {
    const courseId = session.taskId === '' ? '' : (courseOf.get(session.taskId) ?? '');
    if (courseId === '') {
      unattributedSeconds += session.focusedSeconds;
      continue;
    }
    focused.set(courseId, (focused.get(courseId) ?? 0) + session.focusedSeconds);
  }

  const finished = new Map<string, number>();
  for (const task of completed) {
    if (task.courseId === '') continue;
    finished.set(task.courseId, (finished.get(task.courseId) ?? 0) + 1);
  }

  const earned = new Map<string, number>();
  const possible = new Map<string, number>();
  for (const task of graded) {
    if (task.courseId === '' || task.pointsEarned === null || task.pointsPossible === null) {
      continue;
    }
    earned.set(task.courseId, (earned.get(task.courseId) ?? 0) + task.pointsEarned);
    possible.set(task.courseId, (possible.get(task.courseId) ?? 0) + task.pointsPossible);
  }

  const rows = courses
    .map((course) => ({
      course,
      focusedSeconds: focused.get(course.id) ?? 0,
      finished: finished.get(course.id) ?? 0,
      earned: earned.get(course.id) ?? 0,
      possible: possible.get(course.id) ?? 0,
    }))
    // A course with a blank week is left out. The interesting reading is where
    // the time went, and rows of zeroes bury it.
    .filter((row) => row.focusedSeconds > 0 || row.finished > 0 || row.possible > 0)
    .sort((a, b) => b.focusedSeconds - a.focusedSeconds || b.finished - a.finished);

  return { courses: rows, unattributedSeconds };
}
