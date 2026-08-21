'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, TrashSimple } from '@phosphor-icons/react/dist/ssr';
import { completeTask, createTask, deleteTask, updateTask } from '@/lib/db/mutations';
import type { Task } from '@/lib/db/types';
import { useSubtasks } from '@/hooks/use-tasks';
import { useUiStore } from '@/hooks/use-ui';
import { ROW, rowVariants } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { StruckTitle } from './StruckTitle';
import { TaskCheck } from './TaskCheck';

/**
 * Children of one task.
 *
 * Depth is capped at 1 in the data layer, so a subtask never renders this
 * component and there is no recursion to bound. Completing one goes through
 * `completeTask` rather than a status patch, so a repeating subtask still
 * generates its next occurrence.
 *
 * Adding is a button that becomes a field rather than a field sitting open. A
 * bare input under a list reads as part of the list, which is why a task with no
 * children looked like it had one blank one. The field then stays open after
 * Enter, because nobody writes a checklist one item per visit.
 *
 * A title here is editable in place. The parent's title is a textarea at the top
 * of the panel, but a child had no editor anywhere in the app: a subtask typed
 * with a typo could only be deleted and typed again.
 */
export function SubtaskList({ taskId }: { taskId: string }) {
  const subtasks = useSubtasks(taskId);
  // A shortcut on the list asked for this field. The intent lives as long as the
  // panel does, so it holds the field open until the field is closed.
  const wanted = useUiStore((state) => state.openTaskIntent) === 'subtask';
  const clearIntent = useUiStore((state) => state.clearTaskIntent);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const open = adding || wanted;

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  function close() {
    setDraft('');
    setAdding(false);
    clearIntent();
  }

  async function add(titles: string[]) {
    // Cleared first, and whatever the lines turn out to be. Cleared after the
    // early return, a line of spaces stayed in the field after Enter.
    setDraft('');
    const lines = titles.map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length === 0) return;
    // One at a time, in order: the sort key is assigned per insert, so a
    // Promise.all would land a pasted checklist in whatever order it resolved.
    for (const title of lines) {
      await createTask({ title, parentTaskId: taskId, status: 'active' });
    }
  }

  /** Commits a rename, or drops it when the title comes back empty or unchanged.
   *  One mutation per edit, the rule the panel's own fields already follow. */
  async function commitName(subtask: Task) {
    const next = name.trim();
    setEditing(null);
    if (next.length === 0 || next === subtask.title) return;
    await updateTask(subtask.id, { title: next });
  }

  const done = subtasks.filter((t) => t._done === 1).length;

  return (
    <div className="space-y-1">
      {subtasks.length > 0 && (
        <p className="tnum mb-1.5 text-xs text-text-lo">
          {done} of {subtasks.length} done
        </p>
      )}

      <ul className="space-y-0.5">
        <AnimatePresence initial={false}>
          {subtasks.map((subtask) => (
            <motion.li
              key={subtask.id}
              layout="position"
              variants={rowVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={ROW}
              className="group flex items-center gap-2.5 rounded-md py-1"
            >
              <TaskCheck
                checked={subtask._done === 1}
                onChange={(next) => void completeTask(subtask.id, next)}
                label={subtask._done === 1 ? `Reopen ${subtask.title}` : `Complete ${subtask.title}`}
              />
              {editing === subtask.id ? (
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label={`Rename ${subtask.title}`}
                  data-escape-owner
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void commitName(subtask);
                    }
                    if (e.key === 'Escape') {
                      // The edit is abandoned, so the old title comes back and
                      // the panel stays where it is.
                      e.preventDefault();
                      setEditing(null);
                    }
                  }}
                  onBlur={() => void commitName(subtask)}
                  className={cn(
                    'min-w-0 flex-1 rounded-sm bg-transparent py-1 text-sm text-text-hi',
                    'focus:outline-none',
                  )}
                />
              ) : (
                // A button rather than the span it used to be: the title is what
                // you reach for to fix a typo. The wrapper takes the flex space
                // so the strike can size to the words inside it.
                <button
                  type="button"
                  onClick={() => {
                    setEditing(subtask.id);
                    setName(subtask.title);
                  }}
                  aria-label={`Rename ${subtask.title}`}
                  className="min-w-0 flex-1 rounded-sm text-left"
                >
                  <StruckTitle
                    title={subtask.title}
                    done={subtask._done === 1}
                    className={cn(
                      'text-sm transition-colors duration-200',
                      subtask._done === 1 ? 'text-text-lo' : 'text-text-mid',
                    )}
                  />
                </button>
              )}
              <button
                type="button"
                onClick={() => void deleteTask(subtask.id)}
                aria-label={`Delete ${subtask.title}`}
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-md text-text-faint',
                  'opacity-0 hover:text-clay-300 focus-visible:opacity-100 group-hover:opacity-100',
                )}
              >
                <TrashSimple size={14} aria-hidden />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {open ? (
        <div className="flex items-center gap-2.5 pt-1">
          <Plus size={15} className="shrink-0 text-clay-300" aria-hidden />
          <input
            ref={field}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            // Escape belongs to the innermost open thing. Sheet reads this
            // attribute and leaves the press alone, or one Escape mid-draft
            // closes the whole panel and the draft goes with it.
            data-escape-owner
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add([draft]);
                return;
              }
              if (e.key === 'Escape') {
                // Stopped here as well, or the selection bar's Escape reads it
                // as "drop the selection" on the way past.
                e.preventDefault();
                close();
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              if (!text.includes('\n')) return;
              // An input joins pasted lines into one title. A checklist copied
              // from somewhere else is a checklist. What was already typed is
              // the start of the first line, not something to throw away.
              e.preventDefault();
              const [head, ...rest] = text.split('\n');
              void add([`${draft}${head ?? ''}`, ...rest]);
            }}
            onBlur={() => {
              if (draft.trim().length > 0) void add([draft]);
              close();
            }}
            placeholder="Subtask, then Enter for another"
            aria-label="Add a subtask"
            enterKeyHint="enter"
            className={cn(
              'min-w-0 flex-1 bg-transparent py-1 text-sm text-text-hi',
              'placeholder:text-text-lo focus:outline-none',
            )}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn(
            'mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-line',
            'px-2.5 py-2 text-left text-sm text-text-lo',
            'hover:border-clay-400 hover:text-text-mid',
          )}
        >
          <Plus size={15} className="shrink-0" aria-hidden />
          Add a subtask
        </button>
      )}
    </div>
  );
}
