'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { GraduationCap, Trash } from '@phosphor-icons/react/dist/ssr';
import {
  createCourse,
  createTerm,
  deleteCourse,
  restoreCourse,
  updateCourse,
} from '@/lib/db/mutations';
import type { Course, CourseMeeting } from '@/lib/db/types';
import { PROJECT_COLORS } from '@/lib/projects/palette';
import { cn } from '@/lib/utils';
import { useTerms } from '@/hooks/use-courses';
import { Field, controlClass } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { MeetingRows } from './MeetingRows';

/**
 * Build or edit one course.
 *
 * The code leads, because "CS 6035" is what you call it and a course list read
 * by title is a list you have to translate. The title is optional for the same
 * reason: nobody types "Introduction to Information Security" twice.
 *
 * Delete says out loud what happens to the work filed here, since unfiling it is
 * the part nobody would guess. Same wording as the project editor, and the same
 * undo.
 */

const STATUS_OPTIONS: { value: Course['status']; label: string }[] = [
  { value: 'active', label: 'Taking it' },
  { value: 'done', label: 'Finished' },
  { value: 'dropped', label: 'Dropped' },
];

/** A leading space, so it can never collide with a real uuid. */
const NO_TERM = ' none';
const NEW_TERM = ' new';

export function CourseEditor({
  open,
  course,
  termId,
  onClose,
}: {
  open: boolean;
  course?: Course;
  /** Preselected term when adding from inside one. */
  termId?: string;
  onClose: (savedId?: string) => void;
}) {
  const terms = useTerms();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [term, setTerm] = useState(NO_TERM);
  const [credits, setCredits] = useState('3');
  const [instructor, setInstructor] = useState('');
  const [feedLabel, setFeedLabel] = useState('');
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]!);
  const [status, setStatus] = useState<Course['status']>('active');
  const [meetings, setMeetings] = useState<CourseMeeting[]>([]);
  const [ready, setReady] = useState(false);

  // Seeded once per opening rather than in an effect. An effect that syncs props
  // into state runs a second render on every keystroke of the parent.
  if (open && !ready) {
    setReady(true);
    setCode(course?.code ?? '');
    setName(course?.name ?? '');
    setTerm(course?.termId ?? termId ?? NO_TERM);
    setCredits(String(course?.creditHours ?? 3));
    setInstructor(course?.instructor ?? '');
    setFeedLabel(course?.feedLabel ?? '');
    setColor(course?.color ?? PROJECT_COLORS[0]!);
    setStatus(course?.status ?? 'active');
    setMeetings(course?.meetings ?? []);
  }

  function close(savedId?: string) {
    setReady(false);
    onClose(savedId);
  }

  async function save() {
    const trimmed = code.trim();
    if (trimmed.length === 0) return;

    const parsed = Number.parseFloat(credits);
    const creditHours = Number.isFinite(parsed) && parsed >= 0 ? parsed : 3;

    let resolvedTerm = term === NO_TERM || term === NEW_TERM ? '' : term;
    if (term === NEW_TERM) resolvedTerm = await createTerm(guessTerm());

    if (course) {
      await updateCourse(course.id, {
        code: trimmed,
        name: name.trim(),
        termId: resolvedTerm,
        creditHours,
        instructor: instructor.trim(),
        feedLabel: feedLabel.trim(),
        color,
        status,
        meetings,
      });
      close();
      return;
    }

    const id = await createCourse({
      code: trimmed,
      name: name.trim(),
      termId: resolvedTerm,
      creditHours,
      instructor: instructor.trim(),
      feedLabel: feedLabel.trim(),
      color,
      meetings,
    });
    close(id);
  }

  function remove() {
    if (!course) return;
    const doomed = course.id;
    close();
    void deleteCourse(doomed).then(({ taskIds, open: stillOpen }) => {
      toast('Course deleted', {
        description:
          taskIds.length === 0
            ? undefined
            : `${stillOpen} open ${stillOpen === 1 ? 'task' : 'tasks'} left without a course.`,
        action: { label: 'Undo', onClick: () => void restoreCourse(doomed, taskIds) },
      });
    });
  }

  return (
    <Sheet open={open} onClose={() => close()} label={course ? 'Edit course' : 'New course'}>
      <h2 className="flex items-center gap-2 text-lg">
        <GraduationCap size={18} aria-hidden />
        {course ? 'Edit course' : 'New course'}
      </h2>

      <div className="mt-4 space-y-3">
        <Field label="Code" htmlFor="course-code">
          <input
            id="course-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="CS 6035"
            autoComplete="off"
            className={controlClass}
          />
        </Field>

        <Field label="Title" htmlFor="course-name">
          <input
            id="course-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Introduction to Information Security"
            autoComplete="off"
            className={controlClass}
          />
        </Field>

        <Field label="Term" htmlFor="course-term">
          <select
            id="course-term"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className={controlClass}
          >
            <option value={NO_TERM}>No term</option>
            {terms.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
            {/* The first course somebody adds has no term to file it under, and
                sending them to another screen to make one first is how a new
                install stalls. */}
            <option value={NEW_TERM}>Start a new term…</option>
          </select>
        </Field>

        {/* One per row. `Field` is a horizontal row with a fixed 6.5rem label,
            so two of them side by side spend their width on labels: at a 27rem
            panel the credits input came out 13px wide, a slot too narrow to
            show the "3" already in it. Two fields are not worth a second
            layout. */}
        <Field label="Credits" htmlFor="course-credits">
          <input
            id="course-credits"
            value={credits}
            onChange={(event) => setCredits(event.target.value)}
            inputMode="decimal"
            className={cn(controlClass, 'tnum')}
          />
        </Field>

        <Field label="Instructor" htmlFor="course-instructor">
          <input
            id="course-instructor"
            value={instructor}
            onChange={(event) => setInstructor(event.target.value)}
            autoComplete="off"
            className={controlClass}
          />
        </Field>

        {/* The override the feed matcher has always read and nothing could
            write. Matching on the code carries most courses, and when it does
            not there was no way to say so from inside the app. Empty is the
            normal state: filling it in is what you do after an import lands
            something in the Inbox that belonged here. */}
        <Field label="Canvas name" htmlFor="course-feed-label">
          <input
            id="course-feed-label"
            value={feedLabel}
            onChange={(event) => setFeedLabel(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Only if the feed does not match"
            className={controlClass}
          />
        </Field>

        {course && (
          <Field label="Status" htmlFor="course-status">
            <select
              id="course-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as Course['status'])}
              className={controlClass}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Colour">
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_COLORS.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => setColor(hex)}
                aria-label={`Colour ${hex}`}
                aria-pressed={color === hex}
                className={cn(
                  'size-7 rounded-full border-2',
                  color === hex ? 'border-text-hi' : 'border-transparent',
                )}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </Field>

        <Field label="Meets">
          <MeetingRows meetings={meetings} onChange={setMeetings} />
        </Field>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={code.trim().length === 0}
          className={cn(
            'flex-1 rounded-md bg-clay-600 px-3 py-2 text-sm text-on-accent',
            'disabled:opacity-50',
          )}
        >
          {course ? 'Save' : 'Add course'}
        </button>

        {course && (
          <button
            type="button"
            onClick={remove}
            aria-label={`Delete ${course.code}`}
            className={cn(
              'grid size-9 place-items-center rounded-md border border-line',
              'text-text-lo hover:border-clay-400 hover:text-clay-300',
            )}
          >
            <Trash size={15} aria-hidden />
          </button>
        )}
      </div>
    </Sheet>
  );
}

/**
 * A plausible term for the one somebody has not named yet.
 *
 * Guessed from today rather than asked for, because the question it replaces is
 * "what are the exact start and end dates of your semester", which nobody knows
 * on the way to adding a course. Every field of it is editable afterwards.
 */
function guessTerm(): { name: string; startDate: string; endDate: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  // Northern-hemisphere academic shape: spring runs January to May, fall runs
  // August to December, and the gap belongs to whichever is closer.
  const fall = month >= 6;
  return fall
    ? { name: `Fall ${year}`, startDate: `${year}-08-17`, endDate: `${year}-12-12` }
    : { name: `Spring ${year}`, startDate: `${year}-01-08`, endDate: `${year}-05-06` };
}
