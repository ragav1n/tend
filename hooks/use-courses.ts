'use client';

import { useStableLiveQuery } from './use-live';
import {
  componentsOf,
  courseById,
  courseCounts,
  courseDone,
  courseList,
  courseOptions,
  coursesInTerm,
  eventsBetween,
  feedList,
  scoredTasks,
  currentTerm,
  termOptions,
  today,
  type CourseCount,
} from '@/lib/db/queries';
import type { Course, CourseComponent, CourseEvent, Feed, Task, Term } from '@/lib/db/types';

/**
 * Terms and courses, read the same way every other list is.
 *
 * Module-scope placeholders so an empty answer keeps its identity between
 * renders and never triggers one on its own.
 */

const NO_TERMS: Term[] = [];
const NO_COURSES: Course[] = [];
const NO_TASKS: Task[] = [];
const NO_COUNTS = new Map<string, CourseCount>();
const NO_COMPONENTS: CourseComponent[] = [];
const NO_FEEDS: Feed[] = [];
const NO_EVENTS: CourseEvent[] = [];

export function useTerms(): Term[] {
  return useStableLiveQuery(() => termOptions(), [], NO_TERMS);
}

/** The term today sits in, or the most recent one that has started. */
export function useCurrentTerm(): Term | undefined {
  return useStableLiveQuery(() => currentTerm(today()), [], undefined);
}

export function useCourses(): Course[] {
  return useStableLiveQuery(() => courseOptions(), [], NO_COURSES);
}

export function useCoursesInTerm(termId: string | undefined): Course[] {
  return useStableLiveQuery(
    () => (termId === undefined ? Promise.resolve(NO_COURSES) : coursesInTerm(termId)),
    [termId],
    NO_COURSES,
  );
}

export function useCourse(id: string | null): Course | undefined {
  return useStableLiveQuery(
    () => (id === null ? Promise.resolve(undefined) : courseById(id)),
    [id],
    undefined,
  );
}

export function useCourseList(id: string | null): Task[] {
  return useStableLiveQuery(
    () => (id === null ? Promise.resolve(NO_TASKS) : courseList(id)),
    [id],
    NO_TASKS,
  );
}

export function useCourseDone(id: string | null, limit = 25): Task[] {
  return useStableLiveQuery(
    () => (id === null ? Promise.resolve(NO_TASKS) : courseDone(id, limit)),
    [id, limit],
    NO_TASKS,
  );
}

/**
 * Counts and the next deadline for a set of courses.
 *
 * Keyed on the joined ids so it re-runs when the set changes rather than on
 * every render, the same trick `useSubtasksFor` uses.
 */
export function useCourseCounts(courses: readonly Course[]): Map<string, CourseCount> {
  const key = courses.map((course) => course.id).join(',');
  return useStableLiveQuery(
    () => courseCounts(key === '' ? [] : key.split(',')),
    [key],
    NO_COUNTS,
  );
}

/** The weighted buckets of a course. */
export function useComponents(courseId: string | null): CourseComponent[] {
  return useStableLiveQuery(
    () => (courseId === null ? Promise.resolve(NO_COMPONENTS) : componentsOf(courseId)),
    [courseId],
    NO_COMPONENTS,
  );
}

/**
 * Every task in a course carrying points, open or finished.
 *
 * Both halves on purpose: a graded assignment is finished work, and a projection
 * that only read the outstanding half would be reading off nothing.
 */
export function useScoredTasks(courseId: string | null): Task[] {
  return useStableLiveQuery(
    () => (courseId === null ? Promise.resolve(NO_TASKS) : scoredTasks(courseId)),
    [courseId],
    NO_TASKS,
  );
}

export function useFeeds(): Feed[] {
  return useStableLiveQuery(() => feedList(), [], NO_FEEDS);
}

/** Lectures, exams and office hours inside a window, for the calendar layer. */
export function useCourseEvents(from: string, to: string): CourseEvent[] {
  return useStableLiveQuery(() => eventsBetween(from, to), [from, to], NO_EVENTS);
}
