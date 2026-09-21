'use client';

import { useId } from 'react';
import { updatePrefs } from '@/lib/db/mutations';
import { usePrefs } from '@/hooks/use-prefs';
import { cn } from '@/lib/utils';
import { controlClass } from '@/components/ui/Field';

/**
 * How much of a day there is, and which days there are.
 *
 * Hours of real work, not hours awake, and the copy says so. Somebody who puts
 * eight here will be told they are fine right up to the week they are not,
 * which is the opposite of what the figure is for.
 *
 * Days as seven toggles rather than a weekend switch, because "I work Sundays
 * and not Fridays" is a real answer and a boolean cannot hold it.
 */

const DAYS = [
  { value: 1, label: 'M' },
  { value: 2, label: 'T' },
  { value: 3, label: 'W' },
  { value: 4, label: 'T' },
  { value: 5, label: 'F' },
  { value: 6, label: 'S' },
  { value: 7, label: 'S' },
];

export function CapacityRow() {
  const prefs = usePrefs();
  const id = useId();

  const hours = (prefs.dailyCapacityMinutes / 60).toFixed(
    prefs.dailyCapacityMinutes % 60 === 0 ? 0 : 1,
  );

  function toggle(day: number) {
    const next = prefs.workDays.includes(day)
      ? prefs.workDays.filter((each) => each !== day)
      : [...prefs.workDays, day].sort((a, b) => a - b);
    void updatePrefs({ workDays: next });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 py-3.5">
        <div className="min-w-0">
          <label htmlFor={id} className="block text-sm text-text-hi">
            Hours in a working day
          </label>
          <p className="mt-0.5 text-xs leading-snug text-text-lo">
            Hours of real work, not hours awake. Four is a realistic day.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <input
            id={id}
            value={hours}
            onChange={(event) => {
              const parsed = Number.parseFloat(event.target.value);
              if (!Number.isFinite(parsed)) return;
              const minutes = Math.round(Math.min(24, Math.max(0, parsed)) * 60);
              void updatePrefs({ dailyCapacityMinutes: minutes });
            }}
            inputMode="decimal"
            className={cn(controlClass, 'tnum w-16 text-right')}
          />
          <span className="text-xs text-text-lo">h</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 py-3.5">
        <div className="min-w-0">
          <span className="block text-sm text-text-hi">Days you work</span>
          <p className="mt-0.5 text-xs leading-snug text-text-lo">
            A weekend that carries nothing is what makes a Monday deadline read as tight.
          </p>
        </div>
        <div className="flex shrink-0 gap-0.5" role="group" aria-label="Days you work">
          {DAYS.map((day) => {
            const on = prefs.workDays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggle(day.value)}
                aria-pressed={on}
                aria-label={DAY_NAMES[day.value]}
                className={cn(
                  'tnum grid size-7 place-items-center rounded-md border text-xs',
                  on
                    ? 'border-clay-400 bg-clay-600 text-on-accent'
                    : 'border-line text-text-lo hover:border-line-bright',
                )}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Spelled out for the accessible name, since M and T repeat. */
const DAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};
