'use client';

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import {
  CalendarBlank,
  CheckCircle,
  FolderSimple,
  Prohibit,
  Trash,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { cancelTasks, completeTasks, deleteTasks, restoreTasks, updateTasks } from '@/lib/db/mutations';
import { addDays, today } from '@/lib/db/queries';
import { NO_PROJECT, type CancelReason } from '@/lib/db/types';
import { chordIndex, inScope, SELECTION_ACTIONS, typingSafe } from '@/lib/keys/map';
import { QUICK_FADE, SHEET, sheetVariants } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useProjects, useTasksByIds } from '@/hooks/use-tasks';
import { useSelectionStore } from '@/hooks/use-selection';
import { Sheet } from '@/components/ui/Sheet';

/**
 * What you can do to several tasks at once.
 *
 * It covers the phone's bottom nav rather than floating above it. Selecting is
 * a mode, and a mode that leaves its exit sitting next to five destinations is
 * how people end up on another screen with a selection they have forgotten
 * about.
 *
 * The shortcuts are bound here rather than in the app-wide map, which is what
 * `scope: 'selection'` on those bindings means. Backspace has to be a delete
 * key only while there is something selected to delete.
 *
 * One bar for the page, mounted in the shell. Mounted by the list it was one bar
 * per list, and the logbook holds a list per day: eight day groups put eight
 * fixed bars on top of each other, each reading the same count.
 */

const SELECTION_INDEX = chordIndex(inScope(SELECTION_ACTIONS, 'selection'));
const SELECTION_TYPING_SAFE = typingSafe(SELECTION_ACTIONS);

function BarButton({
  label,
  icon: Icon,
  onClick,
  danger = false,
}: {
  label: string;
  icon: typeof Trash;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5',
        'text-xs hover:border-line-bright hover:bg-raised',
        danger ? 'text-clay-200' : 'text-text-mid',
      )}
    >
      <Icon size={16} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function SheetOption({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center rounded-lg border border-line bg-surface',
          'px-3 py-3 text-left text-[0.9375rem] text-text-mid hover:border-line-bright',
        )}
      >
        {label}
      </button>
    </li>
  );
}

function SelectionBar() {
  const reduced = useReducedMotion();
  const ids = useSelectionStore((state) => state.ids);
  const end = useSelectionStore((state) => state.end);
  const clear = useSelectionStore((state) => state.clear);
  const selectAll = useSelectionStore((state) => state.selectAll);
  const projects = useProjects();
  const [sheet, setSheet] = useState<'schedule' | 'project' | 'cancel' | null>(null);

  const picked = [...ids];
  const count = picked.length;
  // A subtask is filed by its parent, which is why `TaskDetail` hides the
  // project field for one and `writeTaskPatch` refuses it. A selection can hold
  // one now that a subtask carrying its own deadline is a row in Today, Upcoming
  // and the calendar, so Move says what it left behind rather than appearing to
  // move rows it cannot.
  const rows = useTasksByIds(picked);
  // `useStableLiveQuery` shows its placeholder while a dependency change
  // settles, so the rows lag the ids by a few milliseconds after each pick.
  // Every count below is read only once they agree.
  const known = rows.length === count;
  const movable = rows.filter((task) => task.depth === 0).map((task) => task.id);
  const staying = known ? count - movable.length : 0;

  /**
   * Runs a bulk write and reports either way.
   *
   * The catch is not decoration. The selection is cleared before the promise
   * settles, so without one a failed write left no toast, no selection to try
   * again with, and nothing but an unhandled rejection in a console nobody has
   * open.
   */
  function run(work: Promise<unknown>, done: string) {
    void work.then(
      () => toast(done),
      () => toast('That did not go through', { description: 'Nothing was changed. Worth another go.' }),
    );
    clear();
  }

  function remove() {
    const doomed = picked;
    clear();
    void deleteTasks(doomed).then(
      () =>
        toast(`${doomed.length} ${doomed.length === 1 ? 'task' : 'tasks'} deleted`, {
          action: { label: 'Undo', onClick: () => void restoreTasks(doomed) },
        }),
      () => toast('Could not delete those', { description: 'They are all still here.' }),
    );
  }

  function cancel(reason: CancelReason) {
    setSheet(null);
    const count = picked.length;
    run(cancelTasks(picked, reason), `${count} ${count === 1 ? 'task' : 'tasks'} cancelled`);
  }

  function move(projectId: string, name: string) {
    // The ids when the rows are not in yet. The write door refuses a subtask's
    // project either way, and one spare history entry beats moving nothing at
    // all because a query had not landed.
    const targets = known ? movable : picked;
    run(
      updateTasks(targets, { projectId }),
      staying > 0 ? `${movable.length} moved to ${name}` : `Moved to ${name}`,
    );
  }

  function schedule(dueDate: string | null) {
    setSheet(null);
    // Clearing the date takes the time with it. A task due at 09:00 on no day
    // is not a state the rest of the app has a meaning for.
    run(
      updateTasks(picked, dueDate === null ? { dueDate: null, dueTime: null } : { dueDate }),
      dueDate === null ? 'Dates cleared' : `Moved to ${dueDate}`,
    );
  }

  useHotkeys(SELECTION_INDEX, SELECTION_TYPING_SAFE, (id) => {
    switch (id) {
      case 'select-all':
        // Every row the page is showing, which on the logbook is every day it
        // has open, not the group the cursor happens to be in.
        selectAll();
        break;
      case 'complete-selected':
        if (count > 0) run(completeTasks(picked), `${count} completed`);
        break;
      case 'delete-selected':
        if (count > 0) remove();
        break;
      case 'exit-selection':
        end();
        break;
    }
  });

  return (
    <>
      <motion.div
        variants={reduced ? undefined : sheetVariants}
        initial={reduced ? { opacity: 0 } : 'hidden'}
        animate={reduced ? { opacity: 1 } : 'visible'}
        exit={reduced ? { opacity: 0 } : 'hidden'}
        transition={reduced ? QUICK_FADE : SHEET}
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 md:left-[232px]',
          'border-t border-line bg-surface/95 backdrop-blur-xl',
          'pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]',
          'pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))]',
        )}
        style={{ boxShadow: 'var(--shadow-lifted)' }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <span className="tnum shrink-0 text-sm text-text-hi">
            {count} selected
          </span>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto">
            <BarButton
              label="Complete"
              icon={CheckCircle}
              onClick={() => count > 0 && run(completeTasks(picked), `${count} completed`)}
            />
            <BarButton label="Schedule" icon={CalendarBlank} onClick={() => setSheet('schedule')} />
            <BarButton label="Move" icon={FolderSimple} onClick={() => setSheet('project')} />
            <BarButton label="Cancel" icon={Prohibit} onClick={() => setSheet('cancel')} />
            <BarButton label="Delete" icon={Trash} danger onClick={() => count > 0 && remove()} />
          </div>

          <button
            type="button"
            onClick={end}
            aria-label="Stop selecting"
            className="grid size-8 shrink-0 place-items-center rounded-md text-text-lo hover:bg-raised hover:text-text-hi"
          >
            <X size={17} aria-hidden />
          </button>
        </div>
      </motion.div>

      <Sheet open={sheet === 'schedule'} onClose={() => setSheet(null)} label="Schedule">
        <h2 className="text-lg">Schedule {count} {count === 1 ? 'task' : 'tasks'}</h2>
        <ul className="mt-4 space-y-2 pb-2">
          <SheetOption label="Today" onClick={() => schedule(today())} />
          <SheetOption label="Tomorrow" onClick={() => schedule(addDays(today(), 1))} />
          <SheetOption label="Next week" onClick={() => schedule(addDays(today(), 7))} />
          <SheetOption label="No date" onClick={() => schedule(null)} />
          <li className="pt-1">
            <label className="label mb-1.5 block">Pick a date</label>
            <input
              type="date"
              aria-label="Due date"
              onChange={(event) => event.target.value && schedule(event.target.value)}
              className={cn(
                'tnum w-full rounded-md border border-line bg-sunken px-2.5 py-2',
                'text-sm text-text-hi focus:border-clay-400 focus:outline-none',
              )}
            />
          </li>
        </ul>
      </Sheet>

      <Sheet open={sheet === 'cancel'} onClose={() => setSheet(null)} label="Cancel tasks">
        <h2 className="text-lg">Cancel {count} {count === 1 ? 'task' : 'tasks'}</h2>
        {/* Said here as well as in the detail panel. The next occurrence of a
            repeat is materialized on completion, so cancelling one ends it. */}
        <p className="mt-1 text-xs text-text-lo">
          They leave your lists and collect under Cancelled in the logbook. Anything that
          repeats stops repeating.
        </p>
        <div className="mt-4 space-y-1">
          <SheetOption label="Skipped it" onClick={() => cancel('skipped')} />
          <SheetOption label="No longer needed" onClick={() => cancel('obsolete')} />
          <SheetOption label="Duplicate" onClick={() => cancel('duplicate')} />
          <SheetOption label="Some other reason" onClick={() => cancel('other')} />
        </div>
      </Sheet>

      <Sheet open={sheet === 'project'} onClose={() => setSheet(null)} label="Move to project">
        <h2 className="text-lg">
          Move {known ? movable.length : count} {(known ? movable.length : count) === 1 ? 'task' : 'tasks'}
        </h2>
        {staying > 0 && (
          <p className="mt-1 text-xs text-text-lo">
            {staying === 1 ? 'One subtask stays' : `${staying} subtasks stay`} with{' '}
            {staying === 1 ? 'its parent' : 'their parents'}.
          </p>
        )}
        <ul className="mt-4 space-y-2 pb-2">
          <SheetOption
            label="Inbox"
            onClick={() => {
              setSheet(null);
              move(NO_PROJECT, 'Inbox');
            }}
          />
          {projects.map((project) => (
            <SheetOption
              key={project.id}
              label={project.name}
              onClick={() => {
                setSheet(null);
                move(project.id, project.name);
              }}
            />
          ))}
        </ul>
      </Sheet>
    </>
  );
}

/** Mounted in the shell so the bar can animate in and out with the mode. */
export function SelectionBarHost() {
  const active = useSelectionStore((state) => state.active);
  return <AnimatePresence>{active && <SelectionBar key="bar" />}</AnimatePresence>;
}
