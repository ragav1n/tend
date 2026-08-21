'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { Icon } from '@phosphor-icons/react';
import {
  ArrowCounterClockwise,
  ArrowRight,
  DownloadSimple,
  FolderSimple,
  Keyboard,
  MagnifyingGlass,
  Plus,
} from '@phosphor-icons/react/dist/ssr';
import { quickCreate } from '@/lib/db/quick-create';
import { undoLast } from '@/lib/db/undo';
import { buildIcs, saveFile } from '@/lib/ics/download';
import { today } from '@/lib/db/queries';
import { NO_DUE_DAY } from '@/lib/db/types';
import { formatDueLabel } from '@/lib/format/date';
import { MODAL, QUICK_FADE, modalVariants } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useScrollLock } from '@/hooks/use-scroll-lock';
import { useProjects, useSearch } from '@/hooks/use-tasks';
import { useSavedViews } from '@/hooks/use-views';
import { useUiStore, type PaletteMode } from '@/hooks/use-ui';
import { Chord } from '@/components/ui/Kbd';
import { ALL_ITEMS } from '@/components/shell/nav';
import { viewIcon } from '@/components/views/viewIcons';
import { CHORD_FOR } from '@/components/shell/keymap';

/**
 * One field over everything: go somewhere, find a task, or type a new one.
 *
 * cmdk owns the listbox semantics and the arrow keys; the filtering is ours.
 * Its scorer ranks a rendered string, and half of what this palette lists comes
 * from an IndexedDB query that has already done its own matching, so letting it
 * re-rank those would mean two disagreeing notions of a match in one list.
 *
 * The task rows are the reason there is no debounce: `searchTasks` is a prefix
 * scan over an index, so it costs microseconds, and `useDeferredValue` keeps a
 * slow render off the keystroke without inventing a delay.
 */

interface Row {
  id: string;
  label: string;
  hint?: string;
  icon: Icon;
  chord?: string;
  run: () => void;
}

function PaletteRow({ row }: { row: Row }) {
  const Icon = row.icon;
  return (
    <Command.Item
      value={row.id}
      onSelect={row.run}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
        'text-text-mid data-[selected=true]:bg-raised data-[selected=true]:text-text-hi',
      )}
    >
      <Icon size={16} className="shrink-0 text-text-lo" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      {row.hint && <span className="shrink-0 text-xs text-text-lo">{row.hint}</span>}
      {/* Hidden on a phone, which has no keys to press. */}
      {row.chord && <Chord chord={row.chord} className="ml-auto hidden md:flex" />}
    </Command.Item>
  );
}

/** Case-insensitive substring, which is what someone typing three letters of a
 *  view name expects. Fuzzy matching earns its keep over hundreds of commands,
 *  not over fourteen. */
function matches(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.toLowerCase());
}

function Palette({ mode, onClose }: { mode: PaletteMode; onClose: () => void }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const openTask = useUiStore((state) => state.openTask);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const tasks = useSearch(deferred);
  const views = useSavedViews();
  // Live projects only. An archived project is finished business, and offering
  // it as a jump target is how work gets filed back into one.
  const projects = useProjects();
  const todayDate = today();

  useScrollLock();

  /**
   * Focus goes back where it came from, so closing the palette with Escape
   * leaves the keyboard where the user left it rather than on the body.
   *
   * The input is focused here rather than with `autoFocus`, which React applies
   * during commit, before this effect runs. With autoFocus the element read as
   * the opener was the palette's own input, and closing it put focus nowhere.
   */
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const trimmed = query.trim();

  const commands: Row[] = useMemo(() => {
    const rows: Row[] = ALL_ITEMS.map((item) => ({
      id: `nav:${item.href}`,
      label: item.label,
      icon: item.icon,
      chord: CHORD_FOR.get(`nav:${item.href}`),
      run: () => router.push(item.href),
    }));
    rows.push({
      id: 'undo',
      label: 'Undo the last change',
      icon: ArrowCounterClockwise,
      chord: CHORD_FOR.get('undo'),
      // A phone has no ⌘Z, so the palette is where undo lives there.
      run: () => void undoLast().then((took) => toast(took ? `Undid: ${took}` : 'Nothing to undo')),
    });
    rows.push({
      id: 'export',
      label: 'Export to a calendar file',
      icon: DownloadSimple,
      run: () =>
        void buildIcs().then(({ body, filename }) => {
          const events = (body.match(/BEGIN:VEVENT/g) ?? []).length;
          if (events === 0) {
            toast('Nothing to export', { description: 'No task has a date yet.' });
            return;
          }
          saveFile(body, filename);
          toast(`Exported ${events} ${events === 1 ? 'task' : 'tasks'}`);
        }),
    });
    rows.push({
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      icon: Keyboard,
      chord: CHORD_FOR.get('shortcuts'),
      run: () => setShortcutsOpen(true),
    });
    return rows;
  }, [router, setShortcutsOpen]);

  const viewRows: Row[] = views.map((view) => ({
    id: `view:${view.id}`,
    label: view.name,
    icon: viewIcon(view.icon),
    run: () => router.push(`/views?v=${view.id}`),
  }));

  const projectRows: Row[] = projects.map((project) => ({
    id: `project:${project.id}`,
    label: project.name,
    icon: FolderSimple,
    run: () => router.push(`/projects?p=${project.id}`),
  }));

  const jumpTargets = [...commands, ...viewRows, ...projectRows];
  const shownCommands =
    trimmed === '' ? jumpTargets : jumpTargets.filter((c) => matches(c.label, trimmed));

  const taskRows: Row[] = tasks.slice(0, 8).map((task) => ({
    id: `task:${task.id}`,
    label: task.title,
    hint: task._dueDay === NO_DUE_DAY ? undefined : formatDueLabel(task._dueDay, todayDate),
    icon: MagnifyingGlass,
    run: () => openTask(task.id),
  }));

  function close() {
    onClose();
  }

  function selectAnd(run: () => void) {
    run();
    close();
  }

  return (
    <>
      <motion.div
        aria-hidden
        onClick={close}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={QUICK_FADE}
        className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm"
      />

      <motion.div
        variants={reduced ? undefined : modalVariants}
        initial={reduced ? { opacity: 0 } : 'hidden'}
        animate={reduced ? { opacity: 1 } : 'visible'}
        // Springs in, fades out. The entrance can afford a spring's tail; the
        // exit cannot, because focus does not return to the field behind it
        // until this element unmounts, and MODAL takes over a second to settle.
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: QUICK_FADE }}
        transition={reduced ? QUICK_FADE : MODAL}
        className={cn(
          'fixed inset-x-0 top-[12vh] z-50 mx-auto w-[min(36rem,calc(100%-2rem))]',
          'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
        )}
      >
        <Command
          label={mode === 'search' ? 'Search tasks' : 'Command palette'}
          // Our filtering, not cmdk's. See the note at the top of the file.
          shouldFilter={false}
          loop
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
          className={cn(
            'overflow-hidden rounded-lg border border-line-bright bg-surface',
          )}
          style={{ boxShadow: 'var(--shadow-lifted)' }}
        >
          <div className="flex items-center gap-2.5 border-b border-line px-3.5">
            <MagnifyingGlass size={17} className="shrink-0 text-text-lo" aria-hidden />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder={mode === 'search' ? 'Search tasks' : 'Search or jump to'}
              className={cn(
                'h-12 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-text-hi',
                'placeholder:text-text-lo focus:outline-none',
              )}
            />
          </div>

          {/* overscroll-contain so a flick at the end of the list does not
              rubber-band the page behind the palette. */}
          <Command.List className="max-h-[min(24rem,50vh)] overflow-y-auto overscroll-contain p-1.5">
            <Command.Empty className="px-2.5 py-6 text-center text-sm text-text-lo">
              Nothing matches {trimmed}
            </Command.Empty>

            {taskRows.length > 0 && (
              <Command.Group heading="Tasks">
                {taskRows.map((row) => (
                  <PaletteRow key={row.id} row={{ ...row, run: () => selectAnd(row.run) }} />
                ))}
              </Command.Group>
            )}

            {trimmed !== '' && (
              <Command.Group heading="Create">
                <PaletteRow
                  row={{
                    id: 'create',
                    label: `Add "${trimmed}"`,
                    icon: Plus,
                    // The same parser the quick-add field uses, so a date or a
                    // #tag typed here lands the same way it would there.
                    run: () => selectAnd(() => void quickCreate(trimmed)),
                  }}
                />
              </Command.Group>
            )}

            {shownCommands.length > 0 && (
              <Command.Group heading="Go to">
                {shownCommands.map((row) => (
                  <PaletteRow key={row.id} row={{ ...row, run: () => selectAnd(row.run) }} />
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div
            className={cn(
              'hidden items-center gap-3 border-t border-line bg-sunken px-3.5 py-2 md:flex',
              'text-[0.6875rem] text-text-lo',
            )}
          >
            <span className="flex items-center gap-1.5">
              <ArrowRight size={12} aria-hidden />
              Enter to open
            </span>
            <span className="ml-auto">Esc to close</span>
          </div>
        </Command>
      </motion.div>
    </>
  );
}

export function CommandPalette() {
  const mode = useUiStore((state) => state.palette);
  const closePalette = useUiStore((state) => state.closePalette);

  // The portal target only exists in the browser, and the palette is never open
  // on the first render, so there is no hydration mismatch to guard against.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {/* A constant key, so reopening while the last one is still animating out
          reuses that element and cancels the exit rather than stacking two. */}
      {mode && <Palette key="palette" mode={mode} onClose={closePalette} />}
    </AnimatePresence>,
    document.body,
  );
}
