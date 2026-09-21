'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CaretDown, GraduationCap, PencilSimple, Plus } from '@phosphor-icons/react/dist/ssr';
import { QuickAdd } from '@/components/task/QuickAdd';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';
import { CourseEditor } from '@/components/courses/CourseEditor';
import { CourseCard } from '@/components/courses/CourseCard';
import { GradesTab } from '@/components/courses/GradesTab';
import { TermGpa } from '@/components/courses/TermGpa';
import { MEETING_DAYS } from '@/components/courses/MeetingRows';
import { TermEditor } from '@/components/courses/TermEditor';
import {
  useComponents,
  useCourse,
  useCourseCounts,
  useCourseDone,
  useCourseList,
  useCoursesInTerm,
  useCurrentTerm,
  useScoredTasks,
  useTerms,
} from '@/hooks/use-courses';
import type { Course, Term } from '@/lib/db/types';
import { reorderCourse } from '@/lib/db/mutations';
import { slotFor } from '@/lib/db/rank';
import { cn } from '@/lib/utils';

/**
 * Courses: the list of them, and one of them.
 *
 * Both live on this route with the open course in `?c=`, for the reason
 * `/views?v=` and `/projects?p=` both give: a dynamic segment cannot be
 * prerendered, and the service worker precaches prerendered views, so a course
 * behind `/courses/[id]` would be the one screen in the app that needs a network
 * to open.
 *
 * A course is not a project and does not live under Projects. It runs for a
 * term, it holds several projects worth of work, and the work inside it is
 * weighted, which is the thing no project has.
 */

export default function CoursesPage() {
  // useSearchParams needs its own boundary for this route to stay prerendered,
  // which is what keeps it in the service worker's precache.
  return (
    <Suspense fallback={<ViewHeader title="Courses" eyebrow="THIS TERM" />}>
      <CoursesScreen />
    </Suspense>
  );
}

function CoursesScreen() {
  const router = useRouter();
  const openId = useSearchParams().get('c');
  const open = useCourse(openId);

  const [editing, setEditing] = useState<{ course?: Course; termId?: string } | null>(null);
  const [editingTerm, setEditingTerm] = useState<{ term?: Term } | null>(null);

  function closeEditor(savedId?: string) {
    // Only a brand new course takes you to it. Saving an edit made from the
    // index should leave you on the index, where you were looking.
    const isNew = editing !== null && editing.course === undefined;
    setEditing(null);
    if (savedId && isNew) router.push(`/courses?c=${savedId}`);
  }

  return (
    <>
      {open ? (
        <OneCourse
          key={open.id}
          course={open}
          onEdit={() => setEditing({ course: open })}
        />
      ) : (
        <CourseIndex
          onNewCourse={(termId) => setEditing({ termId })}
          onEditCourse={(course) => setEditing({ course })}
          onEditTerm={(term) => setEditingTerm({ term })}
        />
      )}

      <CourseEditor
        open={editing !== null}
        course={editing?.course}
        termId={editing?.termId}
        onClose={closeEditor}
      />

      <TermEditor
        open={editingTerm !== null}
        term={editingTerm?.term}
        onClose={() => setEditingTerm(null)}
      />
    </>
  );
}

/**
 * Moves one course and touches nothing else.
 *
 * The rows arrive sorted by `sortKey`, so their positions in the array are the
 * positions on screen, and `slotFor` turns a step into the pair of ranks the
 * moved row lands between. Same helper the projects index uses, for the same
 * off-by-one reason.
 */
function moveCourse(courses: readonly Course[], index: number, delta: -1 | 1) {
  const course = courses[index];
  const slot = slotFor(
    courses.map((each) => each.sortKey),
    index,
    delta,
  );
  if (!course || !slot) return;
  void reorderCourse(course.id, slot.prev, slot.next);
}

function CourseIndex({
  onNewCourse,
  onEditCourse,
  onEditTerm,
}: {
  onNewCourse: (termId?: string) => void;
  onEditCourse: (course: Course) => void;
  onEditTerm: (term: Term) => void;
}) {
  const terms = useTerms();
  const current = useCurrentTerm();
  const [showing, setShowing] = useState<string | null>(null);

  // The term in view: whichever one was picked, else the one today sits in.
  const termId = showing ?? current?.id ?? '';
  const term = terms.find((each) => each.id === termId);
  const courses = useCoursesInTerm(termId === '' ? undefined : termId);
  const counts = useCourseCounts(courses);

  return (
    <>
      <ViewHeader
        title="Courses"
        eyebrow={term ? term.name.toUpperCase() : 'NO TERM YET'}
        subtitle={
          term
            ? `${term.startDate} to ${term.endDate}`
            : 'Add a course and Tend will start a term for it.'
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {terms.length > 1 && (
          <label className="label flex items-center gap-1.5 !text-[0.625rem]">
            <span className="sr-only">Term</span>
            <select
              value={termId}
              onChange={(event) => setShowing(event.target.value)}
              aria-label="Which term to show"
              className="label cursor-pointer appearance-none rounded-md bg-transparent px-1 py-1 !text-[0.625rem] hover:text-text-mid"
            >
              {terms.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {term && (
          <button
            type="button"
            onClick={() => onEditTerm(term)}
            className="label flex items-center gap-1 rounded-md px-1 py-1 !text-[0.625rem] hover:text-text-mid"
          >
            <PencilSimple size={11} aria-hidden />
            Edit term
          </button>
        )}

        <button
          type="button"
          onClick={() => onNewCourse(term?.id)}
          className="label ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 !text-[0.625rem] hover:text-text-mid"
        >
          <Plus size={12} weight="bold" aria-hidden />
          New course
        </button>
      </div>

      {courses.length > 0 && <TermGpa courses={courses} />}

      {courses.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={term ? `Nothing in ${term.name} yet` : 'No courses yet'}
          hint="Add the courses you are taking and the work files itself under them."
        />
      ) : (
        <ul className="space-y-2">
          {courses.map((course, index) => (
            <li key={course.id}>
              <CourseCard
                course={course}
                count={counts.get(course.id)}
                onEdit={() => onEditCourse(course)}
                first={index === 0}
                last={index === courses.length - 1}
                onMove={(delta) => moveCourse(courses, index, delta)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type Tab = 'work' | 'grades' | 'schedule';

function OneCourse({ course, onEdit }: { course: Course; onEdit: () => void }) {
  const [tab, setTab] = useState<Tab>('work');
  const [showDone, setShowDone] = useState(false);
  const tasks = useCourseList(course.id);
  const finished = useCourseDone(course.id);
  const components = useComponents(course.id);
  const scored = useScoredTasks(course.id);

  return (
    <>
      <ViewHeader
        title={course.code}
        eyebrow={course.name ? course.name.toUpperCase() : 'COURSE'}
        subtitle={
          [
            course.instructor,
            `${course.creditHours} ${course.creditHours === 1 ? 'credit' : 'credits'}`,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Link href="/courses" className="label rounded-md px-2 py-1 hover:text-text-mid">
          All courses
        </Link>
        <button
          type="button"
          onClick={onEdit}
          className="label ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 hover:text-text-mid"
        >
          <PencilSimple size={13} aria-hidden />
          Edit
        </button>
      </div>

      {/* Tabs as local state rather than a second search param. A route that
          reads two of them is a route with two ways to be wrong, and the tab you
          were last on is not worth a URL. */}
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Course">
        {(['work', 'grades', 'schedule'] as Tab[]).map((each) => (
          <button
            key={each}
            type="button"
            role="tab"
            aria-selected={tab === each}
            onClick={() => setTab(each)}
            className={cn(
              'label rounded-md px-2.5 py-1.5 !text-[0.625rem]',
              tab === each ? 'bg-raised text-text-hi' : 'hover:text-text-mid',
            )}
          >
            {each === 'work' ? 'Work' : each === 'grades' ? 'Grades' : 'Schedule'}
          </button>
        ))}
      </div>

      {tab === 'work' ? (
        <>
          <div className="mb-5">
            <QuickAdd
              defaults={{ courseId: course.id }}
              placeholder={`What is due for ${course.code}`}
            />
          </div>

          <TaskList
            tasks={tasks}
            reorder={{ field: 'sortKey' }}
            empty={
              <EmptyState
                icon={GraduationCap}
                title="Nothing open here"
                hint="Add what is due above, or import the syllabus later."
              />
            }
          />

          {finished.length > 0 && (
            <section className="mt-6 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => setShowDone((shown) => !shown)}
                aria-expanded={showDone}
                className="label flex items-center gap-1.5 px-1 hover:text-text-mid"
              >
                <CaretDown size={13} aria-hidden />
                {showDone ? 'Hide' : 'Show'} done
                <span className="tnum">({finished.length})</span>
              </button>
              {showDone && (
                <div className="mt-2">
                  <TaskList tasks={finished} />
                </div>
              )}
            </section>
          )}
        </>
      ) : tab === 'grades' ? (
        <GradesTab course={course} components={components} tasks={scored} />
      ) : (
        <CourseSchedule course={course} />
      )}
    </>
  );
}

/**
 * When the course meets, read-only.
 *
 * Editing lives in the course sheet rather than here, so there is one place a
 * meeting is changed. This is the half you look at.
 */
function CourseSchedule({ course }: { course: Course }) {
  if (course.meetings.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No meeting times yet"
        hint="Add them under Edit, and they show up behind your day on the calendar."
      />
    );
  }

  const byDay = [...course.meetings].sort(
    (a, b) => a.byday - b.byday || a.start.localeCompare(b.start),
  );

  return (
    <ul className="space-y-2">
      {byDay.map((meeting, index) => (
        <li
          key={index}
          className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3"
          style={{ boxShadow: 'var(--shadow-flush)' }}
        >
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: course.color }}
            aria-hidden
          />
          <span className="w-16 shrink-0 text-sm text-text-hi">
            {MEETING_DAYS.find((day) => day.value === meeting.byday)?.label}
          </span>
          <span className="tnum text-sm text-text-mid">
            {meeting.start} to {meeting.end}
          </span>
          {meeting.location && (
            <span className="ml-auto truncate text-xs text-text-lo">{meeting.location}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
