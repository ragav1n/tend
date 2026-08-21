'use client';

import Link from 'next/link';
import { Archive, CalendarBlank, PencilSimple } from '@phosphor-icons/react/dist/ssr';
import { formatDueLabel } from '@/lib/format/date';
import type { Project } from '@/lib/db/types';
import type { ProjectCount } from '@/lib/db/queries';
import { cn } from '@/lib/utils';
import { ReorderStack } from '@/components/ui/ReorderStack';
import { Ring } from '@/components/ui/Ring';

/**
 * One project in the index.
 *
 * The whole row is a link and the pencil is a sibling button, never a button
 * inside the anchor: nesting an interactive element inside a link is invalid
 * markup and the browser resolves the click by guessing.
 *
 * The ring is 22px here rather than the header's 44, and it carries no number.
 * Two digits inside a 22px circle crowd the stroke, and the row already says
 * "1 of 3 done" in words a foot to the left. The accessible name still has the
 * count for anyone who cannot see the arc.
 *
 * The carets and the pencil sit in one absolutely positioned group, for the same
 * reason as the pencil alone: they are siblings of the link, never children of
 * it. `onMove` is optional, so the archived list renders the row without them.
 */

const STATUS_LABEL: Partial<Record<Project['status'], string>> = {
  on_hold: 'On hold',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function ProjectRow({
  project,
  count,
  today,
  onEdit,
  onMove,
  first = true,
  last = true,
}: {
  project: Project;
  count: ProjectCount | undefined;
  today: string;
  onEdit: () => void;
  /** Left out where there is no order to change, which is the archived pile. */
  onMove?: (delta: -1 | 1) => void;
  first?: boolean;
  last?: boolean;
}) {
  const open = count?.open ?? 0;
  const done = count?.done ?? 0;
  const total = open + done;
  const status = STATUS_LABEL[project.status];
  const archived = Boolean(project.archivedAt);

  return (
    <li className="relative">
      <Link
        href={`/projects?p=${project.id}`}
        className={cn(
          'flex items-center gap-3 rounded-lg border border-line bg-surface',
          'py-3 pl-3.5 pr-16 hover:border-line-bright',
        )}
        style={{ boxShadow: 'var(--shadow-flush)' }}
      >
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: project.color }}
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[0.9375rem] text-text-hi">{project.name}</span>
            {archived && (
              <span className="label flex shrink-0 items-center gap-1 !text-[0.5625rem]">
                <Archive size={11} aria-hidden />
                Archived
              </span>
            )}
            {status && !archived && (
              <span className="label shrink-0 !text-[0.5625rem]">{status}</span>
            )}
          </span>

          <span className="mt-0.5 flex items-center gap-2.5 text-xs text-text-lo">
            <span className="tnum">
              {total === 0 ? 'No tasks' : `${done} of ${total} done`}
            </span>
            {project.dueDate && (
              <span className="flex items-center gap-1">
                <CalendarBlank size={12} aria-hidden />
                <span className="tnum">{formatDueLabel(project.dueDate, today)}</span>
              </span>
            )}
          </span>
        </span>

        {total > 0 && (
          <Ring
            ratio={done / total}
            size={22}
            strokeWidth={2.5}
            showValue={false}
            label={`${done} of ${total} tasks complete`}
          />
        )}
      </Link>

      <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {onMove && (
          <ReorderStack
            label={project.name}
            first={first}
            last={last}
            onUp={() => onMove(-1)}
            onDown={() => onMove(1)}
          />
        )}

        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${project.name}`}
          className={cn(
            'grid size-8 place-items-center rounded-md',
            'text-text-lo hover:bg-raised hover:text-text-hi',
          )}
        >
          <PencilSimple size={15} aria-hidden />
        </button>
      </span>
    </li>
  );
}
