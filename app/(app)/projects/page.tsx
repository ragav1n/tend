'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CaretDown, CheckCircle, FolderSimple, PencilSimple, Plus, SquaresFour } from '@phosphor-icons/react/dist/ssr';
import { PROJECT_DONE_PAGE, today, type ProjectCount } from '@/lib/db/queries';
import type { Area, Project } from '@/lib/db/types';
import { cn } from '@/lib/utils';
import { useFirstLoadComplete } from '@/hooks/use-tasks';
import {
  useAllProjectsState,
  useAreaGroups,
  useProjectCounts,
  useProjectDone,
  useProjectTasks,
} from '@/hooks/use-projects';
import { reorderArea, reorderProject } from '@/lib/db/mutations';
import { slotFor } from '@/lib/db/rank';
import { AreaEditor } from '@/components/projects/AreaEditor';
import { ProjectEditor } from '@/components/projects/ProjectEditor';
import { ProjectRow } from '@/components/projects/ProjectRow';
import { ReorderStack } from '@/components/ui/ReorderStack';
import { QuickAdd } from '@/components/task/QuickAdd';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewHeader } from '@/components/views/ViewHeader';

/**
 * Projects and areas: the list of them, and one of them.
 *
 * Both live on this route with the open project in `?p=`, for the reason
 * `/views?v=` gives: a dynamic segment cannot be prerendered, and the service
 * worker precaches prerendered views, so a project behind `/projects/[id]` would
 * be the one screen in the app that needs a network to open.
 *
 * The two screens are separate components rather than two branches of one, so
 * the index never runs the open project's task queries.
 *
 * Areas are managed from here rather than from a screen of their own. An area is
 * a name and an order, so a page listing them would be a page of headings with
 * nothing under them, and the place somebody wants to rename one is the place
 * they can see what is filed in it.
 *
 * Both lists reorder with carets rather than by dragging. `reorderProject` had
 * sat with no caller since the day it was written and areas had no reorder at
 * all, so the sort key both tables carry was decided once, at creation, and
 * never again.
 */

/**
 * Moves one row of a list and touches nothing else.
 *
 * The rows arrive sorted by `sortKey`, so their positions in the array are the
 * positions on screen, and `slotFor` turns a step into the pair of ranks the
 * moved row lands between.
 */
function moveWithin<T extends { id: string; sortKey: string }>(
  rows: readonly T[],
  index: number,
  delta: -1 | 1,
  write: (id: string, prev: string | null, next: string | null) => Promise<void>,
) {
  const row = rows[index];
  const slot = slotFor(
    rows.map((each) => each.sortKey),
    index,
    delta,
  );
  if (!row || !slot) return;
  void write(row.id, slot.prev, slot.next);
}

function AreaHeading({
  area,
  onEdit,
  onAdd,
  onMove,
  first = true,
  last = true,
}: {
  area: Area | null;
  onEdit: () => void;
  onAdd: () => void;
  /** Absent on the "No area" group, which is a bucket rather than a row. */
  onMove?: (delta: -1 | 1) => void;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 px-1">
      <h2 className="label !text-[0.5625rem]">{area?.name ?? 'No area'}</h2>

      {area && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${area.name}`}
          className="grid size-6 place-items-center rounded-md text-text-faint hover:bg-raised hover:text-text-mid"
        >
          <PencilSimple size={12} aria-hidden />
        </button>
      )}

      {area && onMove && (
        <ReorderStack
          label={area.name}
          first={first}
          last={last}
          onUp={() => onMove(-1)}
          onDown={() => onMove(1)}
        />
      )}

      <button
        type="button"
        onClick={onAdd}
        aria-label={area ? `New project in ${area.name}` : 'New project with no area'}
        className="ml-auto grid size-6 place-items-center rounded-md text-text-faint hover:bg-raised hover:text-text-mid"
      >
        <Plus size={13} aria-hidden />
      </button>
    </div>
  );
}

function ProjectIndex({
  all,
  loaded,
  onNewProject,
  onNewArea,
  onEditProject,
  onEditArea,
}: {
  all: Project[];
  /** Whether the projects read has settled. Gated on that rather than on
   *  `useFirstLoadComplete`, which settles on a Today query and would let the
   *  empty state flash for somebody who has projects. */
  loaded: boolean;
  onNewProject: (areaId?: string) => void;
  onNewArea: () => void;
  onEditProject: (project: Project) => void;
  onEditArea: (area: Area) => void;
}) {
  const todayDate = today();

  // Split once per change to `all`, not once per render. `useAreaGroups` memoizes
  // on its argument's identity, and a fresh `.filter()` every render defeated it
  // and made the note on that hook untrue.
  const [live, archived] = useMemo(
    () => [
      all.filter((project) => !project.archivedAt),
      all.filter((project) => project.archivedAt),
    ],
    [all],
  );
  const groups = useAreaGroups(live);
  const counts = useProjectCounts(all.map((project) => project.id));
  const [showArchived, setShowArchived] = useState(false);
  // The areas in the order they are shown. `groupByArea` walks them in sort
  // order and appends the unfiled group last, so dropping that one leaves the
  // list a caret has to step through.
  const areas = useMemo(
    () => groups.map((group) => group.area).filter((area): area is Area => area !== null),
    [groups],
  );

  return (
    <>
      <ViewHeader
        title="Projects"
        eyebrow="WHAT THE WORK IS FOR"
        subtitle="A project is a thing with an end. An area is a folder for them."
      />

      <div className="mb-5 flex gap-2">
        <button
          type="button"
          onClick={() => onNewProject()}
          className={cn(
            'flex flex-1 items-center gap-2.5 rounded-lg border border-line bg-sunken',
            'px-3 py-3 text-left text-sm text-text-lo hover:border-clay-400 hover:text-text-mid',
          )}
          style={{ boxShadow: 'var(--shadow-sunken)' }}
        >
          <Plus size={17} aria-hidden />
          New project
        </button>
        <button
          type="button"
          onClick={onNewArea}
          className={cn(
            'flex items-center gap-2 rounded-lg border border-line bg-sunken',
            'px-3 py-3 text-left text-sm text-text-lo hover:border-clay-400 hover:text-text-mid',
          )}
          style={{ boxShadow: 'var(--shadow-sunken)' }}
        >
          <SquaresFour size={17} aria-hidden />
          New area
        </button>
      </div>

      {/* Keyed off the groups, not off the project count. An area with nothing in
          it is still something on the screen, and checking `all.length === 0`
          meant creating the first area looked like it had failed. */}
      {groups.length === 0 && archived.length === 0 && loaded ? (
        <EmptyState
          icon={FolderSimple}
          title="No projects yet"
          hint="Anything that takes more than one task and has an end is a project."
        />
      ) : (
        groups.map((group) => (
          // The gap lives here rather than on the heading. `first:mt-0` on the
          // heading matched every time, because that div is always the first
          // child of its own section, so consecutive groups ran together.
          <section key={group.area?.id ?? 'unfiled'} className="mt-5 first:mt-0">
            <AreaHeading
              area={group.area}
              onEdit={() => group.area && onEditArea(group.area)}
              onAdd={() => onNewProject(group.area?.id)}
              onMove={
                group.area
                  ? (delta) =>
                      moveWithin(
                        areas,
                        areas.findIndex((area) => area.id === group.area?.id),
                        delta,
                        reorderArea,
                      )
                  : undefined
              }
              first={areas[0]?.id === group.area?.id}
              last={areas[areas.length - 1]?.id === group.area?.id}
            />
            {group.projects.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3.5 py-3 text-xs text-text-lo">
                Nothing filed here yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {group.projects.map((project, index) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    count={counts.get(project.id)}
                    today={todayDate}
                    onEdit={() => onEditProject(project)}
                    // Within the area, which is the list on screen. A rank
                    // spanning two areas would be an order nobody can see.
                    onMove={(delta) =>
                      moveWithin(group.projects, index, delta, reorderProject)
                    }
                    first={index === 0}
                    last={index === group.projects.length - 1}
                  />
                ))}
              </ul>
            )}
          </section>
        ))
      )}

      {archived.length > 0 && (
        <section className="mt-6 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => setShowArchived((open) => !open)}
            aria-expanded={showArchived}
            className="label flex items-center gap-1.5 px-1 hover:text-text-mid"
          >
            {showArchived ? 'Hide' : 'Show'} archived
            <span className="tnum">({archived.length})</span>
          </button>

          {showArchived && (
            <ul className="mt-2 space-y-2">
              {archived.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  count={counts.get(project.id)}
                  today={todayDate}
                  onEdit={() => onEditProject(project)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

/** Header progress, or nothing at all while the counts are still arriving or the
 *  project holds no work to be part way through. */
function progressOf(count: ProjectCount | undefined) {
  if (!count) return undefined;
  const total = count.open + count.done;
  if (total === 0) return undefined;
  return { done: count.done, total, ratio: count.done / total };
}

function OneProject({ project, onEdit }: { project: Project; onEdit: () => void }) {
  const tasks = useProjectTasks(project.id);
  const loaded = useFirstLoadComplete();
  const [showDone, setShowDone] = useState(false);
  // Pages of finished work, not a cap. The component is keyed on the project, so
  // opening another one starts at one page again.
  const [pages, setPages] = useState(1);
  const finished = useProjectDone(project.id, pages * PROJECT_DONE_PAGE);

  // From the counts, never from `finished.length`. `projectDone` stops at 50, so
  // a project with sixty finished tasks read "50/55" here and "60 of 65 done" on
  // the index row, and the ring was wrong on the screen that shows it biggest.
  const counts = useProjectCounts([project.id]);
  // Undefined until the counts land. `projectCounts` returns an entry for every
  // id it was asked about, so this is the read settling rather than an empty
  // project, and the difference matters: falling back to zero drew a 0% ring and
  // "0/2 done" for a frame before jumping to the real numbers.
  const count = counts.get(project.id);
  // The real number finished, which is what the disclosure has to say. Before
  // the counts land there is nothing better than what the page holds.
  const doneTotal = count?.done ?? finished.length;
  const unshown = doneTotal - finished.length;
  const firstNoteLine = project.notes.split('\n')[0]?.trim();

  return (
    <>
      <ViewHeader
        title={project.name}
        eyebrow="PROJECT"
        subtitle={firstNoteLine === '' ? undefined : firstNoteLine}
        progress={progressOf(count)}
      />

      <div className="mb-4 flex items-center gap-2">
        <Link href="/projects" className="label rounded-md px-2 py-1 hover:text-text-mid">
          All projects
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

      <div className="mb-5">
        <QuickAdd defaults={{ projectId: project.id }} placeholder={`Add to ${project.name}`} />
      </div>

      <TaskList
        tasks={tasks}
        loading={!loaded}
        empty={
          <EmptyState
            icon={FolderSimple}
            title="Nothing open here"
            hint={
              finished.length > 0
                ? 'Everything in this project is done.'
                : 'Add the first task above.'
            }
          />
        }
      />

      {doneTotal > 0 && (
        <section className="mt-6 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => setShowDone((open) => !open)}
            aria-expanded={showDone}
            className="label flex items-center gap-1.5 px-1 hover:text-text-mid"
          >
            <CheckCircle size={13} aria-hidden />
            {showDone ? 'Hide' : 'Show'} done
            {/* Everything finished, not the page. A number that meant "what is
                loaded" disagreed with the ring above it on any project with more
                history than one page. */}
            <span className="tnum">({doneTotal})</span>
          </button>

          {showDone && (
            <div className="mt-2">
              <TaskList tasks={finished} />

              {unshown > 0 && (
                <button
                  type="button"
                  onClick={() => setPages((n) => n + 1)}
                  className={cn(
                    'label mt-2 flex items-center gap-1 rounded px-0.5 py-1',
                    '!text-[0.625rem] hover:text-text-mid',
                  )}
                >
                  <CaretDown size={11} weight="bold" aria-hidden />
                  <span className="tnum">{unshown}</span> older
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ProjectsScreen() {
  const router = useRouter();
  const openId = useSearchParams().get('p');
  // One read for both screens. Called in each of them it was two live queries
  // over the same rows.
  const { projects: all, loaded } = useAllProjectsState();
  const open = openId ? all.find((project) => project.id === openId) : undefined;

  const [editing, setEditing] = useState<{ project?: Project; areaId?: string } | null>(null);
  const [editingArea, setEditingArea] = useState<{ area?: Area } | null>(null);

  function closeEditor(savedId?: string) {
    // Only a brand new project takes you to it. Saving an edit made from the
    // index should leave you on the index, where you were looking.
    const isNew = editing !== null && editing.project === undefined;
    setEditing(null);
    if (savedId && isNew) router.push(`/projects?p=${savedId}`);
  }

  return (
    <>
      {open ? (
        // Keyed, so the done pages and the disclosure start fresh on another
        // project rather than carrying over from the last one looked at.
        <OneProject key={open.id} project={open} onEdit={() => setEditing({ project: open })} />
      ) : (
        <ProjectIndex
          all={all}
          loaded={loaded}
          onNewProject={(areaId) => setEditing({ areaId })}
          onNewArea={() => setEditingArea({})}
          onEditProject={(project) => setEditing({ project })}
          onEditArea={(area) => setEditingArea({ area })}
        />
      )}

      <ProjectEditor
        open={editing !== null}
        project={editing?.project}
        areaId={editing?.areaId}
        onClose={closeEditor}
      />

      <AreaEditor
        open={editingArea !== null}
        area={editingArea?.area}
        onClose={() => setEditingArea(null)}
      />
    </>
  );
}

export default function ProjectsPage() {
  // useSearchParams needs its own boundary for this route to stay prerendered,
  // which is what keeps it in the service worker's precache.
  return (
    <Suspense fallback={<ViewHeader title="Projects" eyebrow="WHAT THE WORK IS FOR" />}>
      <ProjectsScreen />
    </Suspense>
  );
}
