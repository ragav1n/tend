'use client';

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { componentsOf, scoredTasks } from '@/lib/db/queries';
import type { Course } from '@/lib/db/types';
import { courseGrade, courseStanding, termGpa } from '@/lib/courses/grade';
import { letterFor, scaleFor } from '@/lib/courses/scale';

/**
 * The term, as one number.
 *
 * Deliberately honest about how little it can be speaking for. A 4.0 across one
 * of five courses is not a 4.0, so the line underneath says how many courses and
 * how many credits made it in, and a course with nothing graded is left out
 * rather than scored as a zero.
 *
 * One query for the whole term rather than a hook per course. `useLiveQuery`
 * directly here because the dependency is the joined course ids, and this is a
 * derived read over several tables rather than a list anything else shares.
 */
export function TermGpa({ courses }: { courses: readonly Course[] }) {
  const key = courses.map((course) => `${course.id}:${course.creditHours}`).join(',');

  const grades = useLiveQuery(
    async () => {
      const rows = await Promise.all(
        courses.map(async (course) => {
          const [components, tasks] = await Promise.all([
            componentsOf(course.id),
            scoredTasks(course.id),
          ]);
          const standing = courseStanding(
            components.map((component) => ({
              component,
              tasks: tasks.filter((task) => task.componentId === component.id),
            })),
          );
          return courseGrade(course.id, course.creditHours, standing, scaleFor(course.gradeScale));
        }),
      );
      return rows;
    },
    [key],
    [],
  );

  const summary = useMemo(() => termGpa(grades), [grades]);

  // Nothing graded anywhere yet. A card reading "—" teaches nothing.
  if (summary.gpa === null) return null;

  return (
    <div
      className="mb-4 flex items-center gap-4 rounded-lg border border-line bg-surface px-3.5 py-3"
      style={{ boxShadow: 'var(--shadow-flush)' }}
    >
      <div>
        <p className="label !text-[0.5625rem]">On this pace</p>
        <p className="tnum mt-1 text-2xl leading-none text-text-hi">
          {summary.gpa.toFixed(2)}
        </p>
      </div>

      <p className="text-xs text-text-lo">
        Across <span className="tnum">{summary.counted}</span>{' '}
        {summary.counted === 1 ? 'course' : 'courses'} and{' '}
        <span className="tnum">{summary.credits}</span>{' '}
        {summary.credits === 1 ? 'credit' : 'credits'} with marks in.
        {summary.counted < courses.length && (
          <>
            {' '}
            {courses.length - summary.counted} not counted yet.
          </>
        )}
      </p>

      <ul className="ml-auto hidden shrink-0 gap-2 sm:flex">
        {grades
          .filter((grade) => grade.band !== null)
          .map((grade) => {
            const course = courses.find((each) => each.id === grade.courseId);
            return (
              <li key={grade.courseId} className="text-center">
                <span
                  className="block size-1.5 rounded-full"
                  style={{ backgroundColor: course?.color, margin: '0 auto 4px' }}
                  aria-hidden
                />
                <span className="tnum text-xs text-text-mid">
                  {letterFor(grade.percent!, scaleFor(course?.gradeScale ?? []))}
                </span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
