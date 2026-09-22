'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  BellSimple,
  CalendarBlank,
  Clock,
  Flag,
  FolderSimple,
  Hourglass,
  GraduationCap,
  Percent,
  Prohibit,
  Sun,
  TrashSimple,
} from '@phosphor-icons/react/dist/ssr';
import {
  addTaskReminder,
  cancelTasks,
  createProject,
  removeTaskReminder,
  deleteTask,
  ensureTag,
  restoreTask,
  setTaskTags,
  uncancelTasks,
  updateTask,
  type TaskPatch,
} from '@/lib/db/mutations';
import { today } from '@/lib/db/queries';
import {
  NO_COMPONENT,
  NO_COURSE,
  NO_PROJECT,
  type CancelReason,
  type Priority,
  type Task,
} from '@/lib/db/types';
import { useProjects, useSeries, useTags } from '@/hooks/use-tasks';
import { useComponents, useCourses } from '@/hooks/use-courses';
import { useTaskReminders } from '@/hooks/use-tasks';
import { Field, FieldGroup, controlClass } from '@/components/ui/Field';
import { Markdown } from '@/components/ui/Markdown';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils';
import { RecurrenceEditor } from './RecurrenceEditor';
import { SubtaskList } from './SubtaskList';
import { TaskCheck } from './TaskCheck';
import { TaskHistory } from './TaskHistory';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * Everything about one task, editable.
 *
 * Text fields hold a local draft and commit on blur; pickers commit on change.
 * That split is about the outbox, not about feel. Every commit appends a
 * mutation record, so a per-keystroke title would queue thirty of them for one
 * rename and hand the sync engine thirty rows to coalesce. Blur is the natural
 * end of an edit and produces exactly one.
 *
 * The drafts are seeded once on mount rather than synced from the live row. The
 * panel is keyed on the task id by its host, so opening a different task
 * remounts it, and a live update arriving mid-edit would overwrite what the user
 * is typing rather than help them.
 */

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Med' },
  { value: 3, label: 'High' },
];

const NEW_PROJECT = '__new';

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  // Remounts the dates below once hydration ends. `suppressHydrationWarning`
  // leaves the server's text in the DOM and records the client's in the
  // fiber, so a re-render finds no diff and the wrong date stays. A changed
  // key is what actually writes it. See the hook.
  const hydrated = useHydrated();
  const series = useSeries(task.seriesId);
  const projects = useProjects();
  const courses = useCourses();
  // Only for the course this task is in, so a panel on an ordinary task runs
  // no query at all.
  const components = useComponents(task.courseId === NO_COURSE ? null : task.courseId);
  const reminders = useTaskReminders(task.id);
  const tags = useTags();

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [editingNotes, setEditingNotes] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [estimate, setEstimate] = useState(task.estimateMinutes?.toString() ?? '');
  const [earned, setEarned] = useState(task.pointsEarned?.toString() ?? '');
  const [possible, setPossible] = useState(task.pointsPossible?.toString() ?? '');

  const done = task._done === 1;

  function patch(next: TaskPatch) {
    void updateTask(task.id, next);
  }

  function commitTitle() {
    const trimmed = title.trim();
    // An empty title would leave a row nobody can find or identify, so the field
    // snaps back instead of accepting it.
    if (trimmed.length === 0) {
      setTitle(task.title);
      return;
    }
    if (trimmed !== task.title) patch({ title: trimmed });
  }

  function commitNotes() {
    setEditingNotes(false);
    if (notes !== task.notes) patch({ notes });
  }

  function commitEstimate() {
    const parsed = Number.parseInt(estimate, 10);
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    setEstimate(value?.toString() ?? '');
    if (value !== task.estimateMinutes) patch({ estimateMinutes: value });
  }

  /**
   * The two point fields, committed together.
   *
   * Together because they are one fact: a score of 90 means nothing without what
   * it was out of, and writing them separately would let a blurred field leave
   * the pair half entered and the projection reading off it.
   *
   * A blank score is null rather than zero, which is the distinction the whole
   * projection turns on: an unmarked final is not a final you failed.
   */
  function commitPoints() {
    const read = (value: string) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };

    const nextEarned = read(earned);
    const nextPossible = read(possible);

    setEarned(nextEarned?.toString() ?? '');
    setPossible(nextPossible?.toString() ?? '');

    const change: TaskPatch = {};
    if (nextEarned !== task.pointsEarned) change.pointsEarned = nextEarned;
    if (nextPossible !== task.pointsPossible) change.pointsPossible = nextPossible;
    // Marked today, unless it already carried a date. What the logbook and the
    // review read to say when a grade landed.
    if (change.pointsEarned !== undefined) {
      change.gradedAt = nextEarned === null ? null : (task.gradedAt ?? today());
    }

    if (Object.keys(change).length > 0) patch(change);
  }

  async function toggleTag(tagId: string) {
    const next = task._tagIds.includes(tagId)
      ? task._tagIds.filter((id) => id !== tagId)
      : [...task._tagIds, tagId];
    await setTaskTags(task.id, next);
  }

  async function addTag() {
    const name = newTag.trim();
    if (name.length === 0) return;
    setNewTag('');
    const tagId = await ensureTag(name);
    if (!task._tagIds.includes(tagId)) await setTaskTags(task.id, [...task._tagIds, tagId]);
  }

  async function handleProject(value: string) {
    if (value === NEW_PROJECT) {
      setNewProject(true);
      return;
    }
    patch({ projectId: value });
  }

  async function createAndFile(name: string) {
    const trimmed = name.trim();
    setNewProject(false);
    if (trimmed.length === 0) return;
    const projectId = await createProject({ name: trimmed });
    patch({ projectId });
  }

  /**
   * Gives up on the task, with a reason.
   *
   * The panel stays open, unlike delete. A cancellation is a state the task is
   * in rather than the task leaving, and the row underneath is the one place the
   * reason is visible.
   *
   * The repeat warning is the honest part. The next occurrence of a series is
   * materialized when one is completed, so cancelling one ends the repeat there.
   * Saying so beats a cancel that quietly spawns a successor and leaves two open
   * occurrences of a series that promises exactly one.
   */
  function handleCancel(reason: CancelReason) {
    void cancelTasks([task.id], reason);
    toast('Task cancelled', {
      description: task.seriesId !== '' ? 'This also ends the repeat.' : undefined,
    });
  }

  function handleDelete() {
    // The panel closes first. Watching a sheet sit there animating out a row it
    // no longer owns is worse than the extra frame it costs to close cleanly.
    onClose();
    void deleteTask(task.id);
    toast('Task deleted', {
      action: { label: 'Undo', onClick: () => void restoreTask(task.id) },
    });
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-3">
        <div className="pt-1">
          <TaskCheck
            checked={done}
            onChange={(next) => patch({ status: next ? 'done' : 'active' })}
            label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
            layoutId={`task-check-${task.id}`}
          />
        </div>
        <textarea
          ref={autoGrow}
          value={title}
          rows={1}
          aria-label="Title"
          onChange={(e) => {
            setTitle(e.target.value);
            autoGrow(e.target);
          }}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className={cn(
            'min-w-0 flex-1 resize-none bg-transparent text-lg leading-snug text-text-hi',
            'focus:outline-none',
            done && 'text-text-lo',
          )}
        />
      </header>

      <section>
        {editingNotes ? (
          <textarea
            ref={autoGrow}
            value={notes}
            rows={3}
            autoFocus
            aria-label="Notes"
            placeholder="Notes. Markdown works."
            onChange={(e) => {
              setNotes(e.target.value);
              autoGrow(e.target);
            }}
            onBlur={commitNotes}
            className={cn(controlClass, 'min-h-[5rem] resize-none leading-relaxed')}
            style={{ boxShadow: 'var(--shadow-sunken)' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingNotes(true)}
            className={cn(
              'w-full rounded-md px-2.5 py-2 text-left',
              'hover:bg-sunken/60 focus-visible:bg-sunken/60',
            )}
          >
            {notes.trim().length > 0 ? (
              <Markdown source={notes} />
            ) : (
              <span className="text-sm text-text-lo">Notes. Markdown works.</span>
            )}
          </button>
        )}
      </section>

      {/* Above the dates and the recurrence rule on purpose. The checklist is
          the work; the metadata is how the work is filed. On a phone the old
          order put a task's own steps below everything else in the panel. */}
      <FieldGroup title="Subtasks">
        <SubtaskList taskId={task.id} />
      </FieldGroup>

      <section className="border-t border-line pt-3">
        <Field label="Due" icon={CalendarBlank} htmlFor="due-date">
          <input
            id="due-date"
            type="date"
            value={task.dueDate ?? ''}
            onChange={(e) => patch({ dueDate: e.target.value || null })}
            className={cn(controlClass, 'tnum')}
          />
        </Field>

        <Field label="Time" icon={Clock} htmlFor="due-time">
          <input
            id="due-time"
            type="time"
            value={task.dueTime ?? ''}
            disabled={task.dueDate === null}
            onChange={(e) => patch({ dueTime: e.target.value || null })}
            className={cn(controlClass, 'tnum disabled:text-text-faint')}
          />
        </Field>

        <Field label="Start" icon={CalendarBlank} htmlFor="start-date">
          <input
            id="start-date"
            type="date"
            value={task.startDate ?? ''}
            onChange={(e) => patch({ startDate: e.target.value || null })}
            className={cn(controlClass, 'tnum')}
          />
        </Field>

        <Field label="Planned" icon={Sun} htmlFor="planned-for">
          <div className="flex items-center gap-1.5">
            <input
              id="planned-for"
              type="date"
              value={task.plannedFor ?? ''}
              onChange={(e) => patch({ plannedFor: e.target.value || null })}
              className={cn(controlClass, 'tnum')}
            />
            <button
              type="button"
              onClick={() => patch({ plannedFor: today() })}
              className={cn(
                'label shrink-0 rounded-md border border-line px-2 py-1.5',
                '!text-[0.5625rem] hover:border-clay-400 hover:text-text-mid',
              )}
            >
              Today
            </button>
          </div>
        </Field>

        <Field label="Priority" icon={Flag}>
          <Segmented
            id="priority"
            label="Priority"
            value={task.priority}
            options={PRIORITY_OPTIONS}
            onChange={(priority) => patch({ priority })}
          />
        </Field>

        {/* A subtask takes its project from its parent, so offering the field
            here would let the two disagree. */}
        {task.depth === 0 && (
          <Field label="Project" icon={FolderSimple} htmlFor="project">
            {newProject ? (
              <input
                autoFocus
                placeholder="Project name"
                aria-label="New project name"
                onBlur={(e) => void createAndFile(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setNewProject(false);
                }}
                className={controlClass}
              />
            ) : (
              <select
                id="project"
                value={task.projectId}
                onChange={(e) => void handleProject(e.target.value)}
                className={controlClass}
              >
                <option value={NO_PROJECT}>Inbox</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
                <option value={NEW_PROJECT}>New project…</option>
              </select>
            )}
          </Field>
        )}

        {/* Beside Project rather than instead of it. A task can be CS 6035 work
            and part of a project called Term paper, and being made to choose is
            not a choice anybody wants. A subtask takes both from its parent. */}
        {task.depth === 0 && courses.length > 0 && (
          <Field label="Course" icon={GraduationCap} htmlFor="course">
            <select
              id="course"
              value={task.courseId}
              onChange={(e) =>
                // Clearing the course clears the weighting with it: a component
                // is defined by the course, so it cannot outlive the link.
                patch(
                  e.target.value === NO_COURSE
                    ? { courseId: NO_COURSE, componentId: NO_COMPONENT }
                    : { courseId: e.target.value },
                )
              }
              className={controlClass}
            >
              <option value={NO_COURSE}>No course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code}
                  {course.name ? ` · ${course.name}` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        {/* The marks, and only for coursework. A grocery task keeps a clean
            panel, and these three fields are what the grade projection reads.
            `pointsEarned` stays empty until it is marked, which is what tells an
            ungraded final apart from one that scored zero. */}
        {task.courseId !== NO_COURSE && (
          <>
            {components.length > 0 && (
              <Field label="Counts as" icon={Percent} htmlFor="component">
                <select
                  id="component"
                  value={task.componentId}
                  onChange={(e) => patch({ componentId: e.target.value })}
                  className={controlClass}
                >
                  <option value={NO_COMPONENT}>Not weighted</option>
                  {components.map((component) => (
                    <option key={component.id} value={component.id}>
                      {component.name}
                      {component.weight > 0 ? ` · ${component.weight}%` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Score" icon={Percent} htmlFor="points-earned">
              <span className="flex items-center gap-1.5">
                <input
                  id="points-earned"
                  value={earned}
                  onChange={(e) => setEarned(e.target.value)}
                  onBlur={commitPoints}
                  inputMode="decimal"
                  placeholder="—"
                  aria-label="Points earned"
                  className={cn(controlClass, 'tnum w-16 text-right')}
                />
                <span className="text-xs text-text-lo">out of</span>
                <input
                  id="points-possible"
                  value={possible}
                  onChange={(e) => setPossible(e.target.value)}
                  onBlur={commitPoints}
                  inputMode="decimal"
                  placeholder="—"
                  aria-label="Points possible"
                  className={cn(controlClass, 'tnum w-16 text-right')}
                />
              </span>
            </Field>
          </>
        )}

        {/* Only on a task with a due instant to count back from. A reminder on
            something undated has nothing to be relative to, and offering it
            there would be a control that silently does nothing. */}
        {task.dueDate !== null && (
          <Field label="Remind me" icon={BellSimple} htmlFor="reminder-add">
            <ReminderRow
              taskId={task.id}
              reminders={reminders}
              hasTime={task.dueTime !== null}
            />
          </Field>
        )}

        <Field label="Estimate" icon={Hourglass} htmlFor="estimate">
          <div className="flex items-center gap-2">
            <input
              id="estimate"
              type="number"
              min={1}
              max={1440}
              inputMode="numeric"
              value={estimate}
              placeholder="—"
              onChange={(e) => setEstimate(e.target.value)}
              onBlur={commitEstimate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className={cn(controlClass, 'tnum w-20 text-center')}
            />
            <span className="text-xs text-text-lo">minutes</span>
          </div>
        </Field>

        {/* Keyed on the series so the editor remounts when the row arrives.
            useSeries returns undefined while the read settles, and without the
            remount a task that does repeat would seed its draft as "Never" and
            stay there. */}
        <RecurrenceEditor key={series?.id ?? 'none'} task={task} series={series} />
      </section>

      <FieldGroup title="Tags">
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => {
            const on = task._tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={on}
                onClick={() => void toggleTag(tag.id)}
                className={cn(
                  'rounded-pill border px-2.5 py-1 text-xs transition-colors duration-200',
                  on
                    ? 'border-clay-400 bg-clay-600 text-on-accent'
                    : 'border-line bg-sunken text-text-lo hover:border-clay-400',
                )}
              >
                {tag.name}
              </button>
            );
          })}
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addTag();
              }
            }}
            onBlur={() => void addTag()}
            placeholder="New tag"
            aria-label="Add a tag"
            className={cn(
              'w-24 min-w-0 rounded-pill border border-dashed border-line bg-transparent',
              'px-2.5 py-1 text-xs text-text-hi placeholder:text-text-lo focus:outline-none',
              'focus:border-clay-400',
            )}
          />
        </div>
      </FieldGroup>

      <FieldGroup title="History">
        <TaskHistory taskId={task.id} />
      </FieldGroup>

      <footer className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-text-lo">
          Added{' '}
          <span className="tnum" key={`added-${hydrated}`} suppressHydrationWarning>
            {new Date(task.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </p>
        <div className="flex items-center gap-2">
          {task.status === 'cancelled' ? (
            <button
              type="button"
              onClick={() => void uncancelTasks([task.id])}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5',
                'text-xs text-text-lo hover:border-olive-400 hover:text-olive-300',
              )}
            >
              <Prohibit size={14} aria-hidden />
              Keep it
            </button>
          ) : (
            <CancelMenu onPick={handleCancel} />
          )}

          <button
            type="button"
            onClick={handleDelete}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5',
              'text-xs text-text-lo hover:border-clay-400 hover:text-clay-300',
            )}
          >
            <TrashSimple size={14} aria-hidden />
            Delete
          </button>
        </div>
      </footer>
    </div>
  );
}

/** What the four reasons are called. Kept beside the control that writes them. */
export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  skipped: 'Skipped it',
  obsolete: 'No longer needed',
  duplicate: 'Duplicate',
  other: 'Cancelled',
};

/**
 * Cancel, and why.
 *
 * A select rather than a button plus a follow-up sheet. The reason is the part
 * that makes the status worth having over a delete, and asking for it in a
 * second step is how it ends up as 'other' every time.
 */
function CancelMenu({ onPick }: { onPick: (reason: CancelReason) => void }) {
  return (
    <label className="inline-flex items-center">
      <span className="sr-only">Cancel this task, and why</span>
      <select
        value=""
        onChange={(event) => {
          const reason = event.target.value;
          if (reason !== '') onPick(reason as CancelReason);
        }}
        className={cn(
          'cursor-pointer appearance-none rounded-md border border-line px-2.5 py-1.5',
          'text-xs text-text-lo hover:border-clay-400 hover:text-clay-300',
        )}
      >
        <option value="">Cancel…</option>
        {(Object.keys(CANCEL_REASON_LABEL) as CancelReason[]).map((reason) => (
          <option key={reason} value={reason}>
            {CANCEL_REASON_LABEL[reason]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The offsets worth one tap. Signed minutes, negative for before. */
const REMINDER_OFFSETS: { minutes: number; label: string }[] = [
  { minutes: -10, label: '10m before' },
  { minutes: -60, label: '1h before' },
  { minutes: -1440, label: '1 day before' },
  { minutes: -2880, label: '2 days before' },
  { minutes: -10080, label: '1 week before' },
];

export function offsetLabel(minutes: number): string {
  const known = REMINDER_OFFSETS.find((each) => each.minutes === minutes);
  if (known) return known.label;

  const before = minutes <= 0;
  const size = Math.abs(minutes);
  const said =
    size >= 1440
      ? `${Math.round(size / 1440)}d`
      : size >= 60
        ? `${Math.round(size / 60)}h`
        : `${size}m`;
  return `${said} ${before ? 'before' : 'after'}`;
}

/**
 * Reminders on one task.
 *
 * The chips are the whole control. A picker with a number field and a unit
 * dropdown is three decisions to say "the day before", which is the only thing
 * most people ever want.
 *
 * With none set, the account's own lead time applies, and the row says so
 * rather than looking empty: "no reminder" and "the usual reminder" are
 * different states and the difference is the point of the feature.
 */
function ReminderRow({
  taskId,
  reminders,
  hasTime,
}: {
  taskId: string;
  reminders: readonly { id: string; offsetMinutes: number }[];
  /** An all-day task is reminded at the account's all-day hour, so the offsets
   *  count back from that rather than from midnight. Worth saying once. */
  hasTime: boolean;
}) {
  const set = new Set(reminders.map((each) => each.offsetMinutes));

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {REMINDER_OFFSETS.map((offset) => {
          const on = set.has(offset.minutes);
          return (
            <button
              key={offset.minutes}
              type="button"
              onClick={() => {
                if (on) {
                  const row = reminders.find((each) => each.offsetMinutes === offset.minutes);
                  if (row) void removeTaskReminder(row.id);
                } else {
                  void addTaskReminder(taskId, offset.minutes);
                }
              }}
              aria-pressed={on}
              className={cn(
                'rounded-md border px-2 py-1 text-xs',
                on
                  ? 'border-clay-400 bg-clay-600 text-on-accent'
                  : 'border-line text-text-lo hover:border-line-bright hover:text-text-mid',
              )}
            >
              {offset.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-text-faint">
        {reminders.length === 0
          ? 'Using your usual lead time from Settings.'
          : hasTime
            ? 'Counted back from the due time.'
            : 'Counted back from your all-day reminder hour.'}
      </p>
    </div>
  );
}
