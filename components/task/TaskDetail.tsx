'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarBlank,
  Clock,
  Flag,
  FolderSimple,
  Hourglass,
  Sun,
  TrashSimple,
} from '@phosphor-icons/react/dist/ssr';
import {
  createProject,
  deleteTask,
  ensureTag,
  restoreTask,
  setTaskTags,
  updateTask,
  type TaskPatch,
} from '@/lib/db/mutations';
import { today } from '@/lib/db/queries';
import { NO_PROJECT, type Priority, type Task } from '@/lib/db/types';
import { useProjects, useSeries, useTags } from '@/hooks/use-tasks';
import { Field, FieldGroup, controlClass } from '@/components/ui/Field';
import { Markdown } from '@/components/ui/Markdown';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils';
import { RecurrenceEditor } from './RecurrenceEditor';
import { SubtaskList } from './SubtaskList';
import { TaskCheck } from './TaskCheck';
import { TaskHistory } from './TaskHistory';

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
  const series = useSeries(task.seriesId);
  const projects = useProjects();
  const tags = useTags();

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [editingNotes, setEditingNotes] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [estimate, setEstimate] = useState(task.estimateMinutes?.toString() ?? '');

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
          <span className="tnum" suppressHydrationWarning>
            {new Date(task.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </p>
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
      </footer>
    </div>
  );
}
