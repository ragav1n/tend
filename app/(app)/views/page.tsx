'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Funnel, PencilSimple, Plus, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { VIEW_CANDIDATE_LIMIT } from '@/lib/db/queries';
import type { SavedView } from '@/lib/db/types';
import { describeFilter, type ViewFilter, type ViewSort } from '@/lib/views/filter';
import { cn } from '@/lib/utils';
import { useProjects, useTags } from '@/hooks/use-tasks';
import { useSavedView, useSavedViews, useViewTasks } from '@/hooks/use-views';
import { EmptyState } from '@/components/views/EmptyState';
import { TaskList } from '@/components/views/TaskList';
import { ViewBuilder } from '@/components/views/ViewBuilder';
import { ViewHeader } from '@/components/views/ViewHeader';
import { viewIcon } from '@/components/views/viewIcons';

/**
 * Saved views: the list of them, and one of them.
 *
 * Both live on this route with the open view in `?v=`, rather than a
 * `/views/[id]` segment. A dynamic segment cannot be prerendered, and the
 * service worker precaches prerendered views: a saved view behind a dynamic
 * route would be the one screen in the app that needs a network to open. That
 * is not a trade this app makes.
 *
 * The two screens are separate components rather than two branches of one, so
 * the index does not run the view's query. Called unconditionally, that read
 * deserialized thousands of task rows and re-ran on every unrelated write while
 * somebody looked at a list of names.
 */

/** Names for `describeFilter`, which both screens need. */
function useFilterNames() {
  const projects = useProjects();
  const tags = useTags();
  return {
    projects: new Map(projects.map((project) => [project.id, project.name])),
    tags: new Map(tags.map((tag) => [tag.id, tag.name])),
  };
}

function OneView({
  view,
  onEdit,
}: {
  view: SavedView;
  onEdit: () => void;
}) {
  const names = useFilterNames();
  // Only a manual view is the user's order. Every other sort is the query's, so
  // a caret there would write a rank the screen never reads back.
  const sort = (view.sort as ViewSort) ?? 'manual';
  const { tasks, truncated } = useViewTasks(view.filter as ViewFilter, sort);
  const Icon = viewIcon(view.icon);

  return (
    <>
      <ViewHeader
        title={view.name}
        eyebrow="Saved view"
        subtitle={describeFilter(view.filter as ViewFilter, names)}
      />

      <div className="mb-4 flex items-center gap-2">
        <Link href="/views" className="label rounded-md px-2 py-1 hover:text-text-mid">
          All views
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

      {truncated && (
        // Said out loud rather than swallowed. A filter runs over a bounded read,
        // and a view that quietly omits half the store is worse than one that
        // admits where it stopped.
        <p className="mb-3 flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-xs text-clay-200">
          <WarningCircle size={14} weight="bold" aria-hidden />
          Filtered over the first {VIEW_CANDIDATE_LIMIT.toLocaleString()} tasks. Anything newer is
          not counted here.
        </p>
      )}

      <TaskList
        tasks={tasks}
        reorder={sort === 'manual' ? { field: 'sortKey' } : undefined}
        empty={
          <EmptyState
            icon={Icon}
            title="Nothing matches this view"
            hint="Edit the filter, or let the work arrive."
          />
        }
      />
    </>
  );
}

function ViewIndex({ views, onNew }: { views: SavedView[]; onNew: () => void }) {
  const names = useFilterNames();

  return (
    <>
      <ViewHeader
        title="Views"
        eyebrow="Saved filters"
        subtitle="A filter with a name, so a question you ask every week takes one click."
      />

      <button
        type="button"
        onClick={onNew}
        className={cn(
          'mb-5 flex w-full items-center gap-2.5 rounded-lg border border-line bg-sunken',
          'px-3 py-3 text-left text-sm text-text-lo hover:border-clay-400 hover:text-text-mid',
        )}
        style={{ boxShadow: 'var(--shadow-sunken)' }}
      >
        <Plus size={17} aria-hidden />
        New view
      </button>

      {views.length === 0 ? (
        <EmptyState
          icon={Funnel}
          title="No saved views yet"
          hint="Try one for overdue work, or everything tagged for the weekend."
        />
      ) : (
        <ul className="space-y-2">
          {views.map((saved) => {
            const Icon = viewIcon(saved.icon);
            return (
              <li key={saved.id}>
                <Link
                  href={`/views?v=${saved.id}`}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border border-line bg-surface',
                    'px-3.5 py-3 hover:border-line-bright',
                  )}
                  style={{ boxShadow: 'var(--shadow-flush)' }}
                >
                  <Icon size={19} className="shrink-0 text-clay-300" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] text-text-hi">
                      {saved.name}
                    </span>
                    <span className="block truncate text-xs text-text-lo">
                      {describeFilter(saved.filter as ViewFilter, names)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function ViewsScreen() {
  const router = useRouter();
  const openId = useSearchParams().get('v');
  const views = useSavedViews();
  const view = useSavedView(openId);
  const [editing, setEditing] = useState<'new' | 'current' | null>(null);

  function closeBuilder(savedId?: string) {
    setEditing(null);
    if (savedId) router.push(`/views?v=${savedId}`);
  }

  return (
    <>
      {view ? (
        <OneView view={view} onEdit={() => setEditing('current')} />
      ) : (
        <ViewIndex views={views} onNew={() => setEditing('new')} />
      )}

      <ViewBuilder
        open={editing !== null}
        view={editing === 'current' ? view : undefined}
        onClose={closeBuilder}
      />
    </>
  );
}

export default function ViewsPage() {
  // useSearchParams needs a boundary for this route to stay prerendered, which
  // is what keeps it in the service worker's precache.
  return (
    <Suspense fallback={<ViewHeader title="Views" eyebrow="Saved filters" />}>
      <ViewsScreen />
    </Suspense>
  );
}
