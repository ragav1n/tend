'use client';

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarBlank, Flag, Hash, Plus, FolderSimple } from '@phosphor-icons/react/dist/ssr';
import { parseQuickAdd, type TokenKind } from '@/lib/parse';
import { createTask, ensureProject, ensureTag } from '@/lib/db/mutations';
import { PRESS_DEPTH, QUICK_FADE, SNAPPY } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Quick add with live parsing.
 *
 * Typing "Pay rent tomorrow 9am !p1 #bills" shows chips for the date, time,
 * priority and tag as they are recognized, so the parser's behaviour is visible
 * instead of surprising. The title in the chip row is what will actually be
 * saved, which is the part people get wrong when a parser silently eats a word.
 */

interface QuickAddProps {
  /** Pre-set for the view the input sits in, so Today's field files into Today
   *  and the calendar's files into the day being looked at. */
  defaults?: { plannedFor?: string | null; dueDate?: string | null; projectId?: string };
  placeholder?: string;
}

const CHIP_ICON: Record<TokenKind, React.ComponentType<{ size?: number; weight?: 'fill' | 'bold' }>> = {
  date: CalendarBlank,
  time: CalendarBlank,
  priority: Flag,
  tag: Hash,
  project: FolderSimple,
};

export function QuickAdd({ defaults, placeholder = 'Add a task' }: QuickAddProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reparsed per keystroke. The parser is regex-only over a single line, so this
  // costs microseconds and needs no debounce.
  const parsed = useMemo(() => parseQuickAdd(value), [value]);
  const canSubmit = parsed.title.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Tags and the project are resolved to ids first, so the task and its join
      // rows land in one batch rather than the task appearing unfiled for a beat.
      const tagIds = await Promise.all(parsed.tagNames.map((name) => ensureTag(name)));
      // A typed @project wins over the view default: it is the more specific
      // instruction, and the chip already promised it would be applied.
      const projectId = parsed.projectName
        ? await ensureProject(parsed.projectName)
        : defaults?.projectId;

      // A typed date wins over the view's, for the same reason a typed project
      // does: it is the more specific instruction and the chip already showed it.
      const dueDate = parsed.dueDate ?? defaults?.dueDate ?? null;

      await createTask({
        title: parsed.title,
        dueDate,
        dueTime: parsed.dueTime,
        priority: parsed.priority,
        plannedFor: dueDate === null ? (defaults?.plannedFor ?? null) : null,
        ...(projectId ? { projectId } : {}),
        tagIds,
      });

      setValue('');
      // Keep focus so several tasks can be typed in a row, which is how anyone
      // actually does a brain dump.
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full">
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-lg border border-line bg-sunken px-3 py-2.5',
          'focus-within:border-clay-400',
        )}
        style={{ boxShadow: 'var(--shadow-sunken)' }}
      >
        <Plus size={17} className="shrink-0 text-text-lo" aria-hidden />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') setValue('');
          }}
          placeholder={placeholder}
          aria-label="Add a task"
          enterKeyHint="done"
          autoComplete="off"
          spellCheck
          className={cn(
            'min-w-0 flex-1 bg-transparent text-[0.9375rem] text-text-hi',
            'placeholder:text-text-lo focus:outline-none',
          )}
        />
        <AnimatePresence>
          {canSubmit && (
            <motion.button
              type="button"
              onClick={() => void submit()}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={SNAPPY}
              whileTap={{ y: 1 }}
              className={cn(
                'label shrink-0 rounded-[7px] border border-clay-400 bg-clay-600 px-2.5 py-1',
                '!text-[0.625rem] !text-text-hi hover:bg-clay-500',
              )}
              style={{ boxShadow: 'var(--shadow-flush)' }}
            >
              Add
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {parsed.tokens.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={QUICK_FADE}
            className="mt-2 flex flex-wrap items-center gap-1.5 px-1"
          >
            <span className="text-xs text-text-lo">{parsed.title || '(no title yet)'}</span>
            {parsed.tokens.map((token) => {
              const Icon = CHIP_ICON[token.kind];
              return (
                <motion.span
                  key={`${token.kind}-${token.start}`}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={PRESS_DEPTH}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-pill border border-line-bright',
                    'bg-raised px-2 py-0.5 text-[0.6875rem] text-text-mid',
                  )}
                >
                  <Icon size={11} aria-hidden />
                  {/* Resolved value, not the raw text: "tomorrow" is only useful
                      confirmation if it shows the date it landed on. */}
                  {token.kind === 'date' && parsed.dueDate}
                  {token.kind === 'time' && parsed.dueTime}
                  {token.kind === 'priority' && `P${4 - parsed.priority}`}
                  {token.kind === 'tag' && token.text.slice(1)}
                  {token.kind === 'project' && token.text.slice(1)}
                </motion.span>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
