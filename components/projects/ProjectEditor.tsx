'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Archive, ArrowCounterClockwise, CalendarBlank, FolderSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import {
  createProject,
  deleteProject,
  restoreProject,
  setProjectArchived,
  updateProject,
} from '@/lib/db/mutations';
import type { Project } from '@/lib/db/types';
import { PROJECT_COLORS, swatchFor } from '@/lib/projects/palette';
import { cn } from '@/lib/utils';
import { useAllProjects, useAreas } from '@/hooks/use-projects';
import { Field, controlClass } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';

/**
 * Build or edit one project.
 *
 * Archive is offered above delete and reads as the ordinary way to finish with
 * something, because it is the reversible one. Delete says out loud what it will
 * do to the tasks filed here, since moving them to the Inbox is the part nobody
 * would guess.
 */

const STATUS_OPTIONS: { value: Project['status']; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** A leading space, so it can never collide with a real uuid. */
const NO_AREA = ' none';

function Swatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  // A project made before this picker existed wears the schema default, which is
  // deliberately not in the set. Showing it anyway is what keeps the editor from
  // claiming no colour is chosen and then silently changing it on save.
  const offList = !PROJECT_COLORS.includes(value as (typeof PROJECT_COLORS)[number]);
  const shown = offList ? [value, ...PROJECT_COLORS] : [...PROJECT_COLORS];

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((hex) => {
        const active = hex === value;
        return (
          <button
            key={hex}
            type="button"
            onClick={() => onChange(hex)}
            aria-label={`Colour ${hex}`}
            aria-pressed={active}
            className={cn(
              'grid size-7 place-items-center rounded-md border',
              active ? 'border-clay-400' : 'border-line hover:border-line-bright',
            )}
          >
            <span aria-hidden className="size-3.5 rounded-full" style={{ background: hex }} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The form, mounted only while the sheet is open and seeded at mount.
 *
 * Same reason `ViewBuilder` does it: seeding from props in an effect is a
 * setState in an effect, which is an error under this eslint config, and it
 * would let a sync pull landing mid-edit overwrite what somebody is typing.
 */
function EditorForm({
  project,
  areaId,
  onClose,
}: {
  project?: Project;
  /** Pre-selected area for a new project, so "New project" inside an area lands
   *  in that area. */
  areaId?: string;
  onClose: (savedId?: string) => void;
}) {
  const areas = useAreas();
  const existing = useAllProjects();

  const [name, setName] = useState(project?.name ?? '');
  const [notes, setNotes] = useState(project?.notes ?? '');
  const [area, setArea] = useState(project?.areaId ?? areaId ?? '');
  const [status, setStatus] = useState<Project['status']>(project?.status ?? 'active');
  // Null until somebody picks one, and the shown swatch is derived rather than
  // stored. Seeding `useState` from `existing.length` looked right and was not:
  // the form mounts on the same render the live query is still handing back its
  // placeholder, so the count read 0 every time, the picker passed clay in on
  // every save, and `createProject`'s rotation never ran. Three projects made
  // from this button came out identical.
  //
  // Left null the colour is chosen inside `createProject`'s own transaction,
  // which is the only place that can count what is already there without racing.
  const [pickedColor, setPickedColor] = useState<string | null>(project?.color ?? null);
  const [dueDate, setDueDate] = useState(project?.dueDate ?? '');

  const color = pickedColor ?? swatchFor(existing.length);

  const archived = Boolean(project?.archivedAt);
  const unknownArea = area !== '' && !areas.some((option) => option.id === area);

  async function save() {
    const title = name.trim();
    if (title === '') return;

    if (project) {
      await updateProject(project.id, {
        name: title,
        notes,
        areaId: area,
        status,
        color,
        dueDate: dueDate === '' ? null : dueDate,
      });
      onClose(project.id);
      return;
    }

    // `color` is left off when nobody picked one, so the rotation happens where
    // the count is read transactionally rather than where it was guessed.
    onClose(
      await createProject({
        name: title,
        notes,
        areaId: area,
        ...(pickedColor === null ? {} : { color: pickedColor }),
      }),
    );
  }

  async function toggleArchive() {
    if (!project) return;
    onClose();
    await setProjectArchived(project.id, !archived);
    toast(archived ? 'Project restored' : 'Project archived');
  }

  async function remove() {
    if (!project) return;
    const id = project.id;
    onClose();

    const moved = await deleteProject(id);
    toast('Project deleted', {
      // The open count, not every task moved. The Inbox lists open work, so
      // promising ten tasks and showing two is a lie about where they went.
      description:
        moved.open === 0
          ? undefined
          : `${moved.open} ${moved.open === 1 ? 'task' : 'tasks'} moved to the Inbox.`,
      // Undoes the whole gesture, finished tasks included. Without the ids the
      // restore would hand back an empty project, which is the kind of half-undo
      // this codebase keeps out of the stack.
      action: { label: 'Undo', onClick: () => void restoreProject(id, moved.taskIds) },
    });
  }

  return (
    <>
      <h2 className="text-lg">{project ? 'Edit project' : 'New project'}</h2>

      <div className="mt-4 space-y-1">
        <Field label="Name" icon={FolderSimple} htmlFor="project-name">
          <input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Kitchen rewire"
            className={controlClass}
          />
        </Field>

        <Field label="Colour">
          <Swatches value={color} onChange={setPickedColor} />
        </Field>

        <Field label="Area" htmlFor="project-area">
          <select
            id="project-area"
            value={area === '' ? NO_AREA : area}
            onChange={(event) =>
              setArea(event.target.value === NO_AREA ? '' : event.target.value)
            }
            className={controlClass}
          >
            <option value={NO_AREA}>No area</option>
            {areas.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
            {/* An area this device has not pulled yet, or one deleted on another
                device. With no option carrying the value the browser falls back
                to showing the first one, so the editor would read "No area"
                while the state still held the id and saving would write it
                straight back. The same case `groupByArea` handles on the index. */}
            {unknownArea && <option value={area}>Area not synced yet</option>}
          </select>
        </Field>

        <Field label="Notes" htmlFor="project-notes">
          <textarea
            id="project-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="What finishing this looks like"
            className={cn(controlClass, 'resize-y')}
          />
        </Field>
      </div>

      {project && (
        <section className="mt-4 border-t border-line pt-3">
          <Field label="Status" htmlFor="project-status">
            <select
              id="project-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as Project['status'])}
              className={controlClass}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Due" icon={CalendarBlank} htmlFor="project-due">
            <input
              id="project-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={cn(controlClass, 'tnum')}
            />
          </Field>
        </section>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 pb-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={name.trim() === ''}
          className={cn(
            'rounded-md border border-clay-400 bg-clay-600 px-3 py-2 text-sm text-on-accent',
            'hover:bg-clay-500 disabled:opacity-40',
          )}
          style={{ boxShadow: 'var(--shadow-flush)' }}
        >
          {project ? 'Save' : 'Create project'}
        </button>

        {project && (
          <>
            <button
              type="button"
              onClick={() => void toggleArchive()}
              className={cn(
                'flex items-center gap-1.5 rounded-md border border-line px-2.5 py-2 text-sm',
                'text-text-mid hover:border-line-bright hover:text-text-hi',
              )}
            >
              {archived ? (
                <ArrowCounterClockwise size={16} aria-hidden />
              ) : (
                <Archive size={16} aria-hidden />
              )}
              {archived ? 'Unarchive' : 'Archive'}
            </button>

            <button
              type="button"
              onClick={() => void remove()}
              className={cn(
                'ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm',
                'text-clay-200 hover:bg-raised',
              )}
            >
              <Trash size={16} aria-hidden />
              Delete
            </button>
          </>
        )}
      </div>

      {project && (
        <p className="pb-2 text-xs text-text-lo">
          Deleting files this project&rsquo;s tasks back into the Inbox. Archiving keeps them
          where they are.
        </p>
      )}
    </>
  );
}

export function ProjectEditor({
  open,
  project,
  areaId,
  onClose,
}: {
  open: boolean;
  /** The project being edited, or undefined for a new one. */
  project?: Project;
  areaId?: string;
  onClose: (savedId?: string) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={() => onClose()}
      label={project ? 'Edit project' : 'New project'}
    >
      {/* Keyed, so switching which project is open starts a fresh form rather
          than carrying the last one's fields across. */}
      <EditorForm key={project?.id ?? `new:${areaId ?? ''}`} project={project} areaId={areaId} onClose={onClose} />
    </Sheet>
  );
}
