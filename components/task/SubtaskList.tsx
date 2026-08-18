'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, TrashSimple } from '@phosphor-icons/react/dist/ssr';
import { completeTask, createTask, deleteTask } from '@/lib/db/mutations';
import { useSubtasks } from '@/hooks/use-tasks';
import { ROW, rowVariants } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { TaskCheck } from './TaskCheck';

/**
 * Children of one task.
 *
 * Depth is capped at 1 in the data layer, so a subtask never renders this
 * component and there is no recursion to bound. Completing one goes through
 * `completeTask` rather than a status patch, so a repeating subtask still
 * generates its next occurrence.
 */
export function SubtaskList({ taskId }: { taskId: string }) {
  const subtasks = useSubtasks(taskId);
  const [draft, setDraft] = useState('');

  async function add() {
    const title = draft.trim();
    if (title.length === 0) return;
    // Cleared before the write, so a second subtask can be typed straight away
    // instead of waiting on IndexedDB.
    setDraft('');
    await createTask({ title, parentTaskId: taskId, status: 'active' });
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
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm transition-colors duration-200',
                  subtask._done === 1 ? 'text-text-lo line-through' : 'text-text-mid',
                )}
              >
                {subtask.title}
              </span>
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

      <div className="flex items-center gap-2.5 pt-1">
        <Plus size={15} className="shrink-0 text-text-faint" aria-hidden />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
          onBlur={() => void add()}
          placeholder="Add a subtask"
          aria-label="Add a subtask"
          enterKeyHint="done"
          className={cn(
            'min-w-0 flex-1 bg-transparent py-1 text-sm text-text-hi',
            'placeholder:text-text-lo focus:outline-none',
          )}
        />
      </div>
    </div>
  );
}
