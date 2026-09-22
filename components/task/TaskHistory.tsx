'use client';

import { useMemo, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react/dist/ssr';
import { motion, useReducedMotion } from 'motion/react';
import { describeActivity, type FieldChange } from '@/lib/activity/describe';
import { TASK_HISTORY_LIMIT, today } from '@/lib/db/queries';
import { formatSince } from '@/lib/format/date';
import { useAllProjects } from '@/hooks/use-projects';
import { useTaskHistory } from '@/hooks/use-tasks';
import { QUICK_FADE } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * What has happened to this task.
 *
 * The activity log has existed since phase 5 and had no way of being read: it
 * was written for undo, which only ever looks at the newest entry. Everything
 * else in it, every reschedule and every reopen, was already on the device with
 * nothing to show it.
 *
 * Read-only on purpose. Undo works from the newest gesture backwards, and a
 * "take this one back" button per row would offer to revert an edit that three
 * later edits have since built on, which the log has no way to make safe.
 *
 * Archived projects are in the name lookup, unlike every picker in the app: a
 * history entry describes where a task went at the time, and a project being
 * finished since does not make that untrue.
 *
 * Nothing here is `text-faint`, which measures 2.83 on surface and is reserved
 * for dividers. A log is quiet by nature and every line in it is still a line
 * somebody reads, so the quiet comes from `text-lo`, the AA floor, and from the
 * strike through a value that was replaced.
 */

/** How many entries show before the rest collapse. Enough for the last day of
 *  work on a task without the panel ending in a wall of text. */
const COLLAPSE_AFTER = 4;

export function TaskHistory({ taskId }: { taskId: string }) {
  // Remounts the dates below once hydration ends. `suppressHydrationWarning`
  // leaves the server's text in the DOM and records the client's in the
  // fiber, so a re-render finds no diff and the wrong date stays. A changed
  // key is what actually writes it. See the hook.
  const hydrated = useHydrated();
  const entries = useTaskHistory(taskId);
  const projects = useAllProjects();
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  const names = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  // Undefined means the read has not settled. Rendering the empty state here
  // would flash "Nothing recorded yet" on a task with forty entries.
  if (entries === undefined) return null;
  if (entries.length === 0) {
    return <p className="text-xs text-text-lo">Nothing recorded yet.</p>;
  }

  const shown = expanded ? entries : entries.slice(0, COLLAPSE_AFTER);
  const hidden = entries.length - shown.length;
  // The query stops at its limit, so "12 older" on a task with two hundred
  // entries would be a count of what this component is hiding rather than of
  // what exists. Say which it is.
  const truncated = entries.length === TASK_HISTORY_LIMIT;
  const ctx = {
    today: today(),
    projectName: (id: string) => names.get(id) ?? null,
  };

  return (
    <div>
      <ol className="space-y-1.5">
        {shown.map((entry) => {
          const line = describeActivity(entry, ctx);
          return (
            <li key={entry.id} className="flex gap-2.5 text-xs leading-snug">
              <time
                dateTime={entry.createdAt}
                className="tnum w-[4.5rem] shrink-0 pt-px text-text-lo"
                key={`at-${hydrated}`}
                suppressHydrationWarning
              >
                {formatSince(entry.createdAt)}
              </time>
              <div className="min-w-0 flex-1">
                <span className={cn(line.undone ? 'text-text-lo' : 'text-text-mid')}>
                  {line.verb}
                  {line.undone && <span className="text-text-lo"> · undone</span>}
                </span>
                {line.changes.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5">
                    {line.changes.map((change) => (
                      <Change key={change.label} change={change} muted={line.undone} />
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className={cn(
            'label mt-1.5 flex items-center gap-1 rounded px-0.5 py-1',
            '!text-[0.625rem] hover:text-text-mid',
          )}
        >
          <motion.span
            aria-hidden
            animate={{ rotate: expanded ? 0 : -90 }}
            transition={reduced ? { duration: 0 } : QUICK_FADE}
            className="inline-flex"
          >
            <CaretDown size={11} weight="bold" />
          </motion.span>
          {expanded ? 'Show fewer' : `${hidden} older`}
        </button>
      )}

      {truncated && expanded && (
        <p className="mt-1 text-xs text-text-lo">
          The newest {TASK_HISTORY_LIMIT}. Anything older is kept but not shown.
        </p>
      )}
    </div>
  );
}

function Change({ change, muted }: { change: FieldChange; muted: boolean }) {
  return (
    <li className="flex gap-1.5 text-text-lo">
      <span className="shrink-0">{change.label}</span>
      {change.from === undefined ? (
        <span>changed</span>
      ) : (
        <span className="min-w-0 truncate">
          <span className="line-through">{change.from}</span>{' '}
          <span className={muted ? 'text-text-lo' : 'text-text-mid'}>{change.to}</span>
        </span>
      )}
    </li>
  );
}
