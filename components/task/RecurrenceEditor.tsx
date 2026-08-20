'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/ssr';
import { clearTaskRecurrence, setTaskRecurrence } from '@/lib/db/mutations';
import { today } from '@/lib/db/queries';
import { DEFAULT_RULE, toRule } from '@/lib/db/series';
import type { Task, TaskSeries } from '@/lib/db/types';
import { QUICK_FADE } from '@/lib/motion';
import {
  describeRule,
  isoDow,
  toParts,
  type Freq,
  type IsoDow,
  type RecurrenceRule,
} from '@/lib/recurrence';
import { controlClass, Field } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils';

/**
 * The repeat rule, edited in place.
 *
 * The draft lives in local state and every committed change writes the whole
 * rule through `setTaskRecurrence`. Holding a draft matters because turning
 * recurrence on creates the series row asynchronously: without it the controls
 * would blank for a frame between the click and the row arriving.
 *
 * Interval is the one field committed on blur rather than on change. Every
 * commit appends an outbox record, and a per-keystroke commit on a number input
 * would queue four of them to get from 1 to 14.
 */

const FREQ_LABEL: Record<Freq, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};

/** ISO order, so Monday is 1 and the array index matches the day number. */
const DOW = [
  { dow: 1 as IsoDow, label: 'M', name: 'Monday' },
  { dow: 2 as IsoDow, label: 'T', name: 'Tuesday' },
  { dow: 3 as IsoDow, label: 'W', name: 'Wednesday' },
  { dow: 4 as IsoDow, label: 'T', name: 'Thursday' },
  { dow: 5 as IsoDow, label: 'F', name: 'Friday' },
  { dow: 6 as IsoDow, label: 'S', name: 'Saturday' },
  { dow: 7 as IsoDow, label: 'S', name: 'Sunday' },
];

export function RecurrenceEditor({ task, series }: { task: Task; series: TaskSeries | undefined }) {
  const [draft, setDraft] = useState<RecurrenceRule | null>(series ? toRule(series) : null);
  const [interval, setIntervalText] = useState(String(series?.interval ?? 1));

  /** The date the rule reads from when it has no explicit day or weekday. */
  const anchor = task.dueDate ?? task.occurrenceDate ?? today();

  function commit(next: RecurrenceRule) {
    setDraft(next);
    void setTaskRecurrence(task.id, next);
  }

  function handleFreq(value: Freq | 'never') {
    if (value === 'never') {
      setDraft(null);
      setIntervalText('1');
      void clearTaskRecurrence(task.id);
      return;
    }

    const base = draft ?? DEFAULT_RULE;
    // Each frequency reads different fields, so switching clears the ones that
    // no longer apply. Left in place they are invisible in the summary and then
    // surprise someone months later when they switch back.
    const next: RecurrenceRule = {
      ...base,
      freq: value,
      ...(value === 'weekly' ? { byday: base.byday ?? [isoDow(anchor)] } : { byday: undefined }),
      ...(value === 'monthly' || value === 'yearly'
        ? { bymonthday: base.bymonthday ?? [toParts(anchor).d] }
        : { bymonthday: undefined }),
      ...(value === 'monthly' ? {} : { monthWeek: undefined }),
    };
    commit(next);
  }

  function toggleDay(dow: IsoDow) {
    if (!draft) return;
    const current = draft.byday ?? [];
    const next = current.includes(dow)
      ? current.filter((d) => d !== dow)
      : [...current, dow].sort((a, b) => a - b);
    // An empty weekly rule has nothing to step to, so the last day cannot go.
    if (next.length === 0) return;
    commit({ ...draft, byday: next });
  }

  function commitInterval() {
    if (!draft) return;
    const parsed = Number.parseInt(interval, 10);
    const value = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 365) : 1;
    setIntervalText(String(value));
    if (value !== draft.interval) commit({ ...draft, interval: value });
  }

  const monthlyByWeekday = draft?.monthWeek !== undefined;

  return (
    <>
      <Field label="Repeat" icon={ArrowsClockwise} htmlFor="repeat-freq">
        <select
          id="repeat-freq"
          value={draft?.freq ?? 'never'}
          onChange={(e) => handleFreq(e.target.value as Freq | 'never')}
          className={controlClass}
        >
          <option value="never">Never</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </Field>

      <AnimatePresence initial={false}>
        {draft && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={QUICK_FADE}
            className="mt-1 space-y-2.5 rounded-md border border-line bg-sunken p-3"
            style={{ boxShadow: 'var(--shadow-sunken)' }}
          >
            <div className="flex items-center gap-2 text-sm text-text-mid">
              <span>Every</span>
              <input
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                value={interval}
                aria-label="Repeat interval"
                onChange={(e) => setIntervalText(e.target.value)}
                onBlur={commitInterval}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className={cn(controlClass, 'tnum w-16 bg-void text-center')}
              />
              <span>{FREQ_LABEL[draft.freq][draft.interval === 1 ? 0 : 1]}</span>
            </div>

            {draft.freq === 'weekly' && (
              <div className="flex gap-1" role="group" aria-label="Days of the week">
                {DOW.map(({ dow, label, name }) => {
                  const on = (draft.byday ?? []).includes(dow);
                  return (
                    <button
                      key={dow}
                      type="button"
                      aria-pressed={on}
                      aria-label={name}
                      onClick={() => toggleDay(dow)}
                      className={cn(
                        'size-8 rounded-md border text-xs transition-colors duration-200',
                        on
                          ? 'border-clay-400 bg-clay-600 text-on-accent'
                          : 'border-line bg-void text-text-lo hover:border-clay-400',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {draft.freq === 'monthly' && (
              <Segmented
                id="monthly-mode"
                label="Monthly pattern"
                value={monthlyByWeekday ? 'weekday' : 'day'}
                options={[
                  { value: 'day', label: `Day ${toParts(anchor).d}` },
                  { value: 'weekday', label: 'By weekday' },
                ]}
                onChange={(mode) =>
                  commit(
                    mode === 'weekday'
                      ? {
                          ...draft,
                          bymonthday: undefined,
                          // Which week of the month the anchor falls in.
                          monthWeek: Math.ceil(toParts(anchor).d / 7),
                          byday: [isoDow(anchor)],
                        }
                      : {
                          ...draft,
                          monthWeek: undefined,
                          byday: undefined,
                          bymonthday: [toParts(anchor).d],
                        },
                  )
                }
              />
            )}

            <Segmented
              id="anchor-mode"
              label="Counts from"
              value={draft.anchorMode}
              options={[
                { value: 'due_date', label: 'From due date' },
                { value: 'completion_date', label: 'From completion' },
              ]}
              onChange={(anchorMode) => commit({ ...draft, anchorMode })}
            />

            <div className="flex items-center gap-2">
              <select
                value={draft.endsMode}
                aria-label="Ends"
                onChange={(e) => {
                  const endsMode = e.target.value as RecurrenceRule['endsMode'];
                  commit({
                    ...draft,
                    endsMode,
                    endsOn: endsMode === 'on_date' ? (draft.endsOn ?? anchor) : undefined,
                    endsAfterCount:
                      endsMode === 'after_count' ? (draft.endsAfterCount ?? 10) : undefined,
                  });
                }}
                className={cn(controlClass, 'bg-void')}
              >
                <option value="never">Runs forever</option>
                <option value="on_date">Ends on</option>
                <option value="after_count">Ends after</option>
              </select>

              {draft.endsMode === 'on_date' && (
                <input
                  type="date"
                  aria-label="Ends on"
                  value={draft.endsOn ?? anchor}
                  onChange={(e) => commit({ ...draft, endsOn: e.target.value || undefined })}
                  className={cn(controlClass, 'tnum bg-void')}
                />
              )}

              {draft.endsMode === 'after_count' && (
                <input
                  type="number"
                  min={1}
                  max={999}
                  inputMode="numeric"
                  aria-label="Ends after this many times"
                  value={draft.endsAfterCount ?? 10}
                  onChange={(e) =>
                    commit({
                      ...draft,
                      endsAfterCount: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                    })
                  }
                  className={cn(controlClass, 'tnum w-20 bg-void text-center')}
                />
              )}
            </div>

            {/* The plain-English read-back. A structured rule is easy to set and
                hard to picture, so the app says what it just agreed to. */}
            <p className="text-xs text-text-lo">
              {describeRule(draft)}
              {series && series.completedCount > 0 && (
                <span className="tnum"> · {series.completedCount} done</span>
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
