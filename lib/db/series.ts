import type { RecurrenceRule } from '@/lib/recurrence';
import type { IsoDow } from '@/lib/recurrence';
import type { TaskSeries } from './types';

/**
 * The bridge between the stored series row and the pure rule that
 * `lib/recurrence.ts` evaluates.
 *
 * The row is flat because the Postgres `task_series` table is flat, and keeping
 * the two shapes identical makes the sync mapping a snake_case rename. The
 * evaluator takes a nested object because it is pure and knows nothing about
 * storage. This file is the only place the two meet.
 *
 * Absent optional columns are stored as empty arrays and 0 rather than null,
 * so a row never carries a value IndexedDB cannot hold and the round trip
 * through `toRule` and `fromRule` is lossless.
 */

/** Values a series row carries that are not part of the rule itself. */
type SeriesMeta = Pick<TaskSeries, 'kind' | 'completedCount'>;

export type SeriesFields = Omit<TaskSeries, keyof SeriesMeta | 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'rowVersion' | '_del'>;

export function toRule(series: SeriesFields): RecurrenceRule {
  return {
    freq: series.freq,
    interval: series.interval,
    ...(series.byday.length > 0 ? { byday: series.byday as IsoDow[] } : {}),
    ...(series.bymonthday.length > 0 ? { bymonthday: series.bymonthday } : {}),
    ...(series.bymonth.length > 0 ? { bymonth: series.bymonth } : {}),
    ...(series.monthWeek !== 0 ? { monthWeek: series.monthWeek } : {}),
    anchorMode: series.anchorMode,
    catchupPolicy: series.catchupPolicy,
    endsMode: series.endsMode,
    ...(series.endsOn ? { endsOn: series.endsOn } : {}),
    ...(series.endsAfterCount !== null ? { endsAfterCount: series.endsAfterCount } : {}),
  };
}

export function fromRule(rule: RecurrenceRule): SeriesFields {
  return {
    freq: rule.freq,
    interval: rule.interval,
    byday: rule.byday ?? [],
    bymonthday: rule.bymonthday ?? [],
    bymonth: rule.bymonth ?? [],
    monthWeek: rule.monthWeek ?? 0,
    anchorMode: rule.anchorMode,
    catchupPolicy: rule.catchupPolicy,
    endsMode: rule.endsMode,
    endsOn: rule.endsOn ?? null,
    endsAfterCount: rule.endsAfterCount ?? null,
  };
}

/** The rule a new series starts from: every day, anchored to the due date. */
export const DEFAULT_RULE: RecurrenceRule = {
  freq: 'daily',
  interval: 1,
  anchorMode: 'due_date',
  catchupPolicy: 'skip_to_future',
  endsMode: 'never',
};
