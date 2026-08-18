import { describe, expect, it } from 'vitest';
import type { RecurrenceRule } from '@/lib/recurrence';
import { DEFAULT_RULE, fromRule, toRule } from './series';

/**
 * The stored row is flat and the evaluator takes a nested object, so the only
 * thing that can go wrong here is a field surviving one direction and not the
 * other. These assert the round trip rather than the shapes.
 */

const RULES: RecurrenceRule[] = [
  DEFAULT_RULE,
  { ...DEFAULT_RULE, freq: 'weekly', interval: 2, byday: [1, 3, 5] },
  { ...DEFAULT_RULE, freq: 'monthly', bymonthday: [-1] },
  { ...DEFAULT_RULE, freq: 'monthly', monthWeek: 3, byday: [2] },
  { ...DEFAULT_RULE, freq: 'yearly', bymonth: [4], bymonthday: [15] },
  { ...DEFAULT_RULE, anchorMode: 'completion_date', interval: 3 },
  { ...DEFAULT_RULE, catchupPolicy: 'keep_backlog' },
  { ...DEFAULT_RULE, endsMode: 'on_date', endsOn: '2027-01-01' },
  { ...DEFAULT_RULE, endsMode: 'after_count', endsAfterCount: 12 },
];

describe('the series row and the rule it holds', () => {
  it.each(RULES)('survives a round trip: %o', (rule) => {
    expect(toRule(fromRule(rule))).toEqual(rule);
  });

  it('stores absent fields as empty rather than null', () => {
    // IndexedDB cannot index null, and a row that carries one is a row that
    // silently drops out of a range scan the day one of these gets indexed.
    const stored = fromRule(DEFAULT_RULE);
    expect(stored.byday).toEqual([]);
    expect(stored.bymonthday).toEqual([]);
    expect(stored.bymonth).toEqual([]);
    expect(stored.monthWeek).toBe(0);
  });

  it('reads a stored zero monthWeek back as absent', () => {
    expect(toRule(fromRule(DEFAULT_RULE))).not.toHaveProperty('monthWeek');
  });

  it('keeps a last-day-of-month rule, which is the -1 that looks like a sentinel', () => {
    const stored = fromRule({ ...DEFAULT_RULE, freq: 'monthly', bymonthday: [-1] });
    expect(toRule(stored).bymonthday).toEqual([-1]);
  });
});
