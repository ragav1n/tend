'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Trash } from '@phosphor-icons/react/dist/ssr';
import {
  createSavedView,
  deleteSavedView,
  restoreSavedView,
  updateSavedView,
} from '@/lib/db/mutations';
import { NO_PROJECT, type Priority, type SavedView } from '@/lib/db/types';
import type { DueWindow, StatusScope, ViewFilter, ViewSort } from '@/lib/views/filter';
import { cn } from '@/lib/utils';
import { useProjects, useTags } from '@/hooks/use-tasks';
import { Field, controlClass } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { VIEW_ICON_NAMES, viewIcon } from '@/components/views/viewIcons';

/**
 * Build or edit one saved view.
 *
 * Every axis is a select rather than a query language. A filter people can
 * express in five dropdowns is one they can still read six months later, and
 * the ones that would need a real grammar, or-groups and nesting, are the ones
 * a task app never actually needs.
 */

const STATUS_OPTIONS: { value: StatusScope; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Completed' },
  { value: 'any', label: 'Both' },
];

const DUE_OPTIONS: { value: DueWindow; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due by today' },
  { value: 'week', label: 'Due within a week' },
  { value: 'month', label: 'Due within a month' },
  { value: 'dated', label: 'Has a date' },
  { value: 'none', label: 'No date' },
];

const SORT_OPTIONS: { value: ViewSort; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Newest' },
  { value: 'title', label: 'Title' },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 0, label: 'Any' },
  { value: 1, label: 'P3 and up' },
  { value: 2, label: 'P2 and up' },
  { value: 3, label: 'P1 only' },
];

/** Absent, not empty. A key set to undefined and no key at all mean the same
 *  thing to the filter, and the second is what gets stored. */
function tidy(filter: ViewFilter): ViewFilter {
  const out: ViewFilter = {};
  if (filter.status && filter.status !== 'open') out.status = filter.status;
  if (filter.projectId !== undefined) out.projectId = filter.projectId;
  if (filter.tagIds && filter.tagIds.length > 0) out.tagIds = filter.tagIds;
  if (filter.minPriority) out.minPriority = filter.minPriority;
  if (filter.due && filter.due !== 'any') out.due = filter.due;
  if (filter.text?.trim()) out.text = filter.text.trim();
  return out;
}

/** A leading space, so it can never collide with a real uuid or with Inbox. */
const ANY_PROJECT = ' any';

/**
 * The form itself, mounted only while the sheet is open.
 *
 * Its state is seeded from the row at mount rather than synced in an effect.
 * An effect would be a setState per open, which `react-hooks/set-state-in-effect`
 * rejects here, and it would also let a sync pull landing mid-edit overwrite
 * what somebody is typing.
 */
function BuilderForm({
  view,
  onClose,
}: {
  view?: SavedView;
  onClose: (savedId?: string) => void;
}) {
  const projects = useProjects();
  const tags = useTags();

  const [name, setName] = useState(view?.name ?? '');
  const [icon, setIcon] = useState(view?.icon ?? 'Funnel');
  const [sort, setSort] = useState<ViewSort>((view?.sort as ViewSort) ?? 'manual');
  const [pinned, setPinned] = useState(view?.pinned ?? true);
  const [filter, setFilter] = useState<ViewFilter>((view?.filter as ViewFilter) ?? {});

  function patch(next: Partial<ViewFilter>) {
    setFilter((current) => ({ ...current, ...next }));
  }

  async function save() {
    const title = name.trim();
    if (title === '') return;

    // Cast at the boundary: the row type says "a filter this client may not
    // fully understand", which is what lets a newer client's extra key survive
    // a round trip through an older one.
    const body = {
      name: title,
      icon,
      filter: { ...tidy(filter) } as Record<string, unknown>,
      sort,
      pinned,
    };
    if (view) {
      await updateSavedView(view.id, body);
      onClose(view.id);
    } else {
      onClose(await createSavedView(body));
    }
  }

  function remove() {
    if (!view) return;
    const id = view.id;
    onClose();
    void deleteSavedView(id);
    toast('View deleted', {
      action: { label: 'Undo', onClick: () => void restoreSavedView(id) },
    });
  }

  return (
    <>
      <h2 className="text-lg">{view ? 'Edit view' : 'New view'}</h2>

      <div className="mt-4 space-y-1">
        <Field label="Name" htmlFor="view-name">
          <input
            id="view-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Overdue at work"
            className={controlClass}
          />
        </Field>

        <Field label="Icon">
          <div className="flex flex-wrap gap-1.5">
            {VIEW_ICON_NAMES.map((option) => {
              const OptionIcon = viewIcon(option);
              const active = option === icon;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setIcon(option)}
                  aria-label={option}
                  aria-pressed={active}
                  className={cn(
                    'grid size-8 place-items-center rounded-md border',
                    active
                      ? 'border-clay-400 bg-raised text-clay-200'
                      : 'border-line text-text-lo hover:text-text-mid',
                  )}
                >
                  <OptionIcon size={16} aria-hidden />
                </button>
              );
            })}
          </div>
        </Field>
      </div>

      <section className="mt-4 border-t border-line pt-3">
        <h3 className="label mb-1.5">Shows</h3>

        <Field label="Status" htmlFor="view-status">
          <select
            id="view-status"
            value={filter.status ?? 'open'}
            onChange={(event) => patch({ status: event.target.value as StatusScope })}
            className={controlClass}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Project" htmlFor="view-project">
          <select
            id="view-project"
            value={filter.projectId ?? ANY_PROJECT}
            onChange={(event) =>
              patch({
                projectId: event.target.value === ANY_PROJECT ? undefined : event.target.value,
              })
            }
            className={controlClass}
          >
            <option value={ANY_PROJECT}>Any</option>
            <option value={NO_PROJECT}>Inbox</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due" htmlFor="view-due">
          <select
            id="view-due"
            value={filter.due ?? 'any'}
            onChange={(event) => patch({ due: event.target.value as DueWindow })}
            className={controlClass}
          >
            {DUE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority" htmlFor="view-priority">
          <select
            id="view-priority"
            value={filter.minPriority ?? 0}
            onChange={(event) => patch({ minPriority: Number(event.target.value) as Priority })}
            className={controlClass}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {tags.length > 0 && (
          <Field label="Tags">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const active = (filter.tagIds ?? []).includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      patch({
                        tagIds: active
                          ? (filter.tagIds ?? []).filter((id) => id !== tag.id)
                          : [...(filter.tagIds ?? []), tag.id],
                      })
                    }
                    className={cn(
                      'rounded-pill border px-2.5 py-1 text-xs',
                      active
                        ? 'border-clay-400 bg-raised text-text-hi'
                        : 'border-line text-text-lo hover:text-text-mid',
                    )}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Words" htmlFor="view-text">
          <input
            id="view-text"
            value={filter.text ?? ''}
            onChange={(event) => patch({ text: event.target.value })}
            placeholder="Any word in the title or notes"
            className={controlClass}
          />
        </Field>
      </section>

      <section className="mt-4 border-t border-line pt-3">
        <Field label="Sort by" htmlFor="view-sort">
          <select
            id="view-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as ViewSort)}
            className={controlClass}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Sidebar">
          <label className="flex items-center gap-2 text-sm text-text-mid">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
              className="size-4 accent-clay-600"
            />
            Show in the sidebar
          </label>
        </Field>
      </section>

      <div className="mt-6 flex items-center gap-2 pb-2">
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
          {view ? 'Save' : 'Create view'}
        </button>

        {view && (
          <button
            type="button"
            onClick={remove}
            className={cn(
              'ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm',
              'text-clay-200 hover:bg-raised',
            )}
          >
            <Trash size={16} aria-hidden />
            Delete
          </button>
        )}
      </div>
    </>
  );
}

export function ViewBuilder({
  open,
  view,
  onClose,
}: {
  open: boolean;
  /** The view being edited, or undefined for a new one. */
  view?: SavedView;
  onClose: (savedId?: string) => void;
}) {
  return (
    <Sheet open={open} onClose={() => onClose()} label={view ? 'Edit view' : 'New view'}>
      {/* Keyed, so switching which view is being edited starts a fresh form
          rather than carrying the last one's fields across. */}
      <BuilderForm key={view?.id ?? 'new'} view={view} onClose={onClose} />
    </Sheet>
  );
}
