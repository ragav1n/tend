import { addDays, stepOnce, type RecurrenceRule } from '@/lib/recurrence';
import type { PlainDate, Task } from '@/lib/db/types';
import { localDay } from './review';

/**
 * How a repeating task is going: the run of occurrences done on schedule, and
 * the last few weeks as dots.
 *
 * A streak counts occurrences, not calendar days, so "every Monday" done four
 * Mondays running is a streak of four rather than one. Two done occurrences are
 * consecutive when the second falls on or before the day the rule steps to from
 * the first. A missed day leaves a gap past that step, because the roll and the
 * catch-up both move the next occurrence beyond it, and the gap is what breaks
 * the run.
 */

export interface HabitStats {
  current: number;
  best: number;
  /** Oldest first, ending today. `done` when an occurrence was finished that day. */
  days: { date: PlainDate; done: boolean }[];
}

export function habitStats(
  rule: RecurrenceRule,
  occurrences: readonly Task[],
  todayDate: PlainDate,
  window = 28,
): HabitStats {
  const done = occurrences
    .filter((t) => t.status === 'done' && t.completedAt !== null)
    .map((t) => ({
      scheduled: t.occurrenceDate ?? localDay(t.completedAt!),
      finished: localDay(t.completedAt!),
    }))
    .sort((a, b) => (a.scheduled < b.scheduled ? -1 : a.scheduled > b.scheduled ? 1 : 0));

  // What the rule steps from, which is the finish day for a completion anchor.
  const anchorOf = (o: { scheduled: PlainDate; finished: PlainDate }) =>
    rule.anchorMode === 'completion_date' ? o.finished : o.scheduled;

  let run = 0;
  let best = 0;
  for (let i = 0; i < done.length; i++) {
    const prev = done[i - 1];
    const expected = prev ? stepOnce(rule, anchorOf(prev)) : null;
    run = prev && (expected === null || done[i]!.scheduled <= expected) ? run + 1 : 1;
    best = Math.max(best, run);
  }

  // The open occurrence says whether the run is still alive. One that is late,
  // or that was rolled past the step after the last one done, means a day went
  // by without it.
  const last = done.at(-1);
  const open = occurrences.find((t) => t.status !== 'done' && t.status !== 'cancelled');
  if (last && open?.occurrenceDate) {
    const expected = stepOnce(rule, anchorOf(last));
    if (open.occurrenceDate < todayDate || (expected !== null && open.occurrenceDate > expected)) {
      run = 0;
    }
  }

  const finishedOn = new Set(done.map((o) => o.finished));
  const days = Array.from({ length: window }, (_, i) => {
    const date = addDays(todayDate, i - window + 1);
    return { date, done: finishedOn.has(date) };
  });

  return { current: run, best, days };
}
