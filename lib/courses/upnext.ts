import type { Course, CourseEvent, PlainDate, Task } from '@/lib/db/types';
import { NO_DUE_DAY } from '@/lib/db/types';
import { isoDayOf } from '@/lib/workload/capacity';

/**
 * What a student's day actually needs to know.
 *
 * Today already lists the work. What it cannot say from a list of rows is "the
 * next thing owed to each course, and when", which is the shape the question
 * comes in: not "what is due" but "which course am I behind on".
 */

export interface NextUp {
  course: Course;
  task: Task;
  /** Whole days from today. Negative is overdue. */
  days: number;
}

function daysFrom(today: PlainDate, day: PlainDate): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${day}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * The soonest open deadline in each active course, soonest first.
 *
 * One row per course rather than one per task. Five deadlines in one course is
 * a list you already have; the useful summary is that four courses each want
 * something, and which wants it first.
 *
 * A course with nothing open is left out rather than shown as clear. The strip
 * is a list of what is owed, and padding it with courses that owe nothing makes
 * the ones that do harder to see.
 */
export function nextUp(
  courses: readonly Course[],
  tasks: readonly Task[],
  today: PlainDate,
  limit = 4,
): NextUp[] {
  const open = tasks.filter(
    (task) => task._done === 0 && task._dueDay !== NO_DUE_DAY && task.parentTaskId === '',
  );

  const soonest = new Map<string, Task>();
  for (const task of open) {
    if (task.courseId === '') continue;
    const held = soonest.get(task.courseId);
    if (!held || task._dueDay < held._dueDay) soonest.set(task.courseId, task);
  }

  return courses
    .filter((course) => course.status === 'active' && soonest.has(course.id))
    .map((course) => {
      const task = soonest.get(course.id)!;
      return { course, task, days: daysFrom(today, task._dueDay) };
    })
    .sort((a, b) => a.task._dueDay.localeCompare(b.task._dueDay))
    .slice(0, limit);
}

/** "today", "tomorrow", "3 days", "2 days late". */
export function whenLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return '1 day late';
  if (days < 0) return `${-days} days late`;
  return `${days} days`;
}

export interface ClassToday {
  course: Course;
  start: string;
  end: string;
  location: string;
}

/**
 * The classes meeting today, earliest first.
 *
 * Read off `courses.meetings`, which is a weekly pattern rather than a list of
 * dates, so this is the only place that turns a weekday into "today". A course
 * that is finished or dropped is left out: its timetable is not news.
 */
export function classesOn(
  courses: readonly Course[],
  day: PlainDate,
): ClassToday[] {
  const weekday = isoDayOf(day);

  return courses
    .filter((course) => course.status === 'active')
    .flatMap((course) =>
      course.meetings
        .filter((meeting) => meeting.byday === weekday)
        .map((meeting) => ({
          course,
          start: meeting.start,
          end: meeting.end,
          location: meeting.location,
        })),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Exams inside the next few weeks, soonest first.
 *
 * Three weeks because that is roughly when an exam starts changing what you do
 * today. Anything further out is a date, not a plan.
 */
export function examRadar(
  events: readonly CourseEvent[],
  today: PlainDate,
  withinDays = 21,
): { event: CourseEvent; days: number }[] {
  return events
    .filter((event) => event.kind === 'exam' && event.startsOn >= today)
    .map((event) => ({ event, days: daysFrom(today, event.startsOn) }))
    .filter((each) => each.days <= withinDays)
    .sort((a, b) => a.event.startsOn.localeCompare(b.event.startsOn));
}
