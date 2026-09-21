'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Sparkle, Trash, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { createTask } from '@/lib/db/mutations';
import type { Course, CourseComponent, Term } from '@/lib/db/types';
import { applyMapping, detectColumns, toRows, type ColumnRole, type SyllabusRow } from '@/lib/syllabus/paste';
import { extractSyllabus } from '@/lib/syllabus/model';
import { today } from '@/lib/db/queries';
import { useLocalModel } from '@/hooks/use-local-model';
import { cn } from '@/lib/utils';
import { controlClass } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';

/**
 * A syllabus, pasted in and checked before anything is written.
 *
 * The Canvas feed carries only what an instructor entered with a date on it.
 * Everything that lives in the syllabus PDF and nowhere else arrives here.
 *
 * Two layers, and the order matters. The grid is the feature: it works offline,
 * on a phone, with nothing installed. The model is an assist that fills the grid
 * in faster when one happens to be reachable, and it never writes a task. It
 * fills a form you confirm, which is the only arrangement in which pointing a
 * 4B model at a deadline list is a reasonable thing to do.
 *
 * The column guess is shown, never applied silently. A date column read as
 * points would file a hundred assignments on the wrong day, and the difference
 * between guessing well and guessing invisibly is the whole reason the grid is
 * here.
 */

const ROLE_LABEL: Record<ColumnRole, string> = {
  title: 'Title',
  due: 'Due',
  points: 'Points',
  ignore: 'Ignore',
};

export function SyllabusImport({
  open,
  course,
  term,
  components,
  onClose,
}: {
  open: boolean;
  course: Course;
  term: Term | undefined;
  components: readonly CourseComponent[];
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [roles, setRoles] = useState<ColumnRole[] | null>(null);
  const [rows, setRows] = useState<SyllabusRow[] | null>(null);
  const [componentId, setComponentId] = useState('');
  const [busy, setBusy] = useState(false);

  const { settings, probe, checking, check } = useLocalModel();

  const window_ = useMemo(
    () => ({ today: today(), termStart: term?.startDate, termEnd: term?.endDate }),
    [term],
  );

  const parsed = useMemo(() => {
    if (text.trim() === '') return null;
    const { rows: cells, delimiter } = toRows(text);
    const guess = roles ?? detectColumns(cells, window_).roles;
    return { cells, delimiter, roles: guess, preview: applyMapping(cells, { roles: guess }, window_) };
  }, [text, roles, window_]);

  // The model's rows replace the parse; otherwise the parse is what you see.
  const shown = rows ?? parsed?.preview ?? [];

  function reset() {
    setText('');
    setRoles(null);
    setRows(null);
    setComponentId('');
    onClose();
  }

  async function runModel() {
    setBusy(true);
    try {
      const result = await extractSyllabus(text, {
        endpoint: settings.endpoint,
        model: settings.model,
        window: window_,
      });

      if ('reason' in result) {
        toast('The model could not read it', { description: result.reason });
        return;
      }
      if (result.rows.length === 0) {
        toast('The model found no graded work in that', {
          description: 'The grid below still has whatever the plain read found.',
        });
        return;
      }

      setRows(result.rows);
      toast(`${result.rows.length} found`, { description: 'Check them before adding.' });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const usable = shown.filter((row) => row.title.trim() !== '');
    if (usable.length === 0) return;

    setBusy(true);
    try {
      // One after another through the same write door everything else uses, so
      // each lands with its own activity entry and undo works per row. A single
      // batch would be one undo for a hundred tasks.
      for (const row of usable) {
        await createTask({
          title: row.title.trim(),
          courseId: course.id,
          dueDate: row.due,
          pointsPossible: row.points,
          ...(componentId === '' ? {} : { componentId }),
        });
      }

      toast(`${usable.length} added to ${course.code}`);
      reset();
    } finally {
      setBusy(false);
    }
  }

  const dated = shown.filter((row) => row.due !== null).length;

  return (
    <Sheet open={open} onClose={reset} label="Import a syllabus">
      <h2 className="text-lg">Paste the syllabus</h2>
      <p className="mt-1 text-xs text-text-lo">
        A schedule table or a list of assignments. Tend reads the dates; you check them before
        anything is added.
      </p>

      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setRoles(null);
          setRows(null);
        }}
        rows={6}
        placeholder={'Week 3\tSep 14\tProject 1\t100'}
        spellCheck={false}
        className={cn(controlClass, 'mt-3 font-mono text-xs')}
      />

      {text.trim() !== '' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Only once something has said a model is there. A button that fails
              is worse than a button that is absent, and off is the normal
              state. */}
          {probe === null ? (
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking}
              className="label flex items-center gap-1.5 rounded-md px-2 py-1 !text-[0.625rem] hover:text-text-mid"
            >
              <Sparkle size={12} aria-hidden />
              {checking ? 'Looking' : 'Try a local model'}
            </button>
          ) : probe.reachable ? (
            <button
              type="button"
              onClick={() => void runModel()}
              disabled={busy}
              className={cn(controlClass, 'inline-flex w-auto items-center gap-1.5 px-2.5 text-xs')}
            >
              <Sparkle size={12} aria-hidden />
              {busy ? 'Reading' : `Read it with ${settings.model}`}
            </button>
          ) : (
            <span className="text-xs text-text-faint">
              No local model answered. The grid below works without one.
            </span>
          )}
        </div>
      )}

      {parsed !== null && parsed.delimiter !== null && rows === null && (
        <div className="mt-3">
          <p className="label mb-1.5 !text-[0.5625rem]">What each column is</p>
          <div className="flex flex-wrap gap-1.5">
            {parsed.roles.map((role, index) => (
              <label key={index} className="flex items-center gap-1">
                <span className="sr-only">{`Column ${index + 1}`}</span>
                <select
                  value={role}
                  onChange={(event) => {
                    const next = [...parsed.roles];
                    next[index] = event.target.value as ColumnRole;
                    setRoles(next);
                  }}
                  aria-label={`Column ${index + 1} holds`}
                  className={cn(controlClass, 'w-auto py-1 text-xs')}
                >
                  {(Object.keys(ROLE_LABEL) as ColumnRole[]).map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <p className="label !text-[0.5625rem]">
              {shown.length} found, <span className="tnum">{dated}</span> dated
            </p>
            {components.length > 0 && (
              <select
                value={componentId}
                onChange={(event) => setComponentId(event.target.value)}
                aria-label="Count all of these toward"
                className={cn(controlClass, 'ml-auto w-auto py-1 text-xs')}
              >
                <option value="">No weight</option>
                {components.map((component) => (
                  <option key={component.id} value={component.id}>
                    Counts as {component.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {shown.map((row, index) => (
              <li key={index} className="flex items-center gap-1.5">
                <input
                  value={row.title}
                  onChange={(event) => edit(index, { title: event.target.value })}
                  aria-label={`Title of row ${index + 1}`}
                  className={cn(controlClass, 'min-w-0 flex-1 py-1 text-xs')}
                />
                <input
                  type="date"
                  value={row.due ?? ''}
                  onChange={(event) => edit(index, { due: event.target.value || null })}
                  aria-label={`Due date of row ${index + 1}`}
                  className={cn(controlClass, 'tnum w-[8.5rem] shrink-0 py-1 text-xs')}
                />
                {row.due === null && row.dueText !== '' && (
                  <span
                    className="shrink-0 text-xs text-clay-200"
                    title={`The syllabus said "${row.dueText}"`}
                  >
                    <WarningCircle size={13} weight="bold" aria-hidden />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setRows(shown.filter((_, at) => at !== index))}
                  aria-label={`Remove row ${index + 1}`}
                  className="grid size-6 shrink-0 place-items-center rounded text-text-faint hover:text-clay-300"
                >
                  <Trash size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button
        type="button"
        onClick={() => void confirm()}
        disabled={busy || shown.length === 0}
        className={cn(
          'mt-4 w-full rounded-md bg-clay-600 px-3 py-2 text-sm text-on-accent',
          'disabled:opacity-50',
        )}
      >
        {shown.length === 0
          ? 'Nothing to add yet'
          : `Add ${shown.length} to ${course.code}`}
      </button>
    </Sheet>
  );

  function edit(index: number, patch: Partial<SyllabusRow>) {
    setRows(shown.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }
}
