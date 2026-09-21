'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarBlank, Trash } from '@phosphor-icons/react/dist/ssr';
import { createTerm, deleteTerm, restoreTerm, updateTerm } from '@/lib/db/mutations';
import type { Term } from '@/lib/db/types';
import { cn } from '@/lib/utils';
import { Field, controlClass } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';

/**
 * Build or edit one term.
 *
 * A name and two dates, which is the whole of it. Deleting one unfiles the
 * courses in it rather than taking them with it, and the toast says so, because
 * a course that vanished with its semester is a course you cannot find.
 */
export function TermEditor({
  open,
  term,
  onClose,
}: {
  open: boolean;
  term?: Term;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ready, setReady] = useState(false);

  if (open && !ready) {
    setReady(true);
    setName(term?.name ?? '');
    setStartDate(term?.startDate ?? '');
    setEndDate(term?.endDate ?? '');
  }

  function close() {
    setReady(false);
    onClose();
  }

  const valid = name.trim().length > 0 && startDate !== '' && endDate !== '' && startDate <= endDate;

  async function save() {
    if (!valid) return;
    if (term) await updateTerm(term.id, { name: name.trim(), startDate, endDate });
    else await createTerm({ name: name.trim(), startDate, endDate });
    close();
  }

  function remove() {
    if (!term) return;
    const doomed = term.id;
    close();
    void deleteTerm(doomed).then(({ courseIds }) => {
      toast('Term deleted', {
        description:
          courseIds.length === 0
            ? undefined
            : `${courseIds.length} ${courseIds.length === 1 ? 'course' : 'courses'} left without a term.`,
        action: { label: 'Undo', onClick: () => void restoreTerm(doomed, courseIds) },
      });
    });
  }

  return (
    <Sheet open={open} onClose={close} label={term ? 'Edit term' : 'New term'}>
      <h2 className="flex items-center gap-2 text-lg">
        <CalendarBlank size={18} aria-hidden />
        {term ? 'Edit term' : 'New term'}
      </h2>

      <div className="mt-4 space-y-3">
        <Field label="Name" htmlFor="term-name">
          <input
            id="term-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Fall 2026"
            autoComplete="off"
            className={controlClass}
          />
        </Field>

        <Field label="Starts" htmlFor="term-start">
          <input
            id="term-start"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className={cn(controlClass, 'tnum')}
          />
        </Field>

        <Field label="Ends" htmlFor="term-end">
          <input
            id="term-end"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className={cn(controlClass, 'tnum')}
          />
        </Field>

        {startDate !== '' && endDate !== '' && startDate > endDate && (
          <p className="text-xs text-clay-200">The end date comes before the start.</p>
        )}
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!valid}
          className={cn(
            'flex-1 rounded-md bg-clay-600 px-3 py-2 text-sm text-on-accent',
            'disabled:opacity-50',
          )}
        >
          {term ? 'Save' : 'Add term'}
        </button>

        {term && (
          <button
            type="button"
            onClick={remove}
            aria-label={`Delete ${term.name}`}
            className={cn(
              'grid size-9 place-items-center rounded-md border border-line',
              'text-text-lo hover:border-clay-400 hover:text-clay-300',
            )}
          >
            <Trash size={15} aria-hidden />
          </button>
        )}
      </div>
    </Sheet>
  );
}
