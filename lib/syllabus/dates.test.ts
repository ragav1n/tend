import { describe, expect, it } from 'vitest';
import { resolveSyllabusDate } from './dates';

/** Mid-term: 21 September, inside a Fall 2026 semester. */
const FALL = { today: '2026-09-21', termStart: '2026-08-17', termEnd: '2026-12-11' };

describe('a date off a syllabus', () => {
  it('keeps a date that already passed in the term it belongs to', () => {
    // The bug this exists for. parseQuickAdd rolls a bare month and day
    // forward, so "Sep 14" a week ago came back as 2027 and the assignment sat
    // in Upcoming for a year instead of going overdue.
    expect(resolveSyllabusDate('Sep 14', FALL)).toBe('2026-09-14');
  });

  it('keeps a date still to come', () => {
    expect(resolveSyllabusDate('Oct 2', FALL)).toBe('2026-10-02');
  });

  it('reaches the end of the term', () => {
    expect(resolveSyllabusDate('Dec 8', FALL)).toBe('2026-12-08');
  });

  it('takes a written year as written', () => {
    expect(resolveSyllabusDate('2027-01-20', FALL)).toBe('2027-01-20');
    expect(resolveSyllabusDate('Jan 20 2027', FALL)).toBe('2027-01-20');
  });

  it('puts a January date in the spring term it belongs to', () => {
    // Pasted in January, a term running into May.
    const spring = { today: '2027-01-15', termStart: '2027-01-11', termEnd: '2027-05-07' };
    expect(resolveSyllabusDate('Jan 11', spring)).toBe('2027-01-11');
    expect(resolveSyllabusDate('Apr 30', spring)).toBe('2027-04-30');
  });

  it('crosses a year end inside one term', () => {
    // A term running December into January: a "Jan 8" pasted in December is
    // next year, and the term window is the only thing that knows.
    const winter = { today: '2026-12-15', termStart: '2026-11-30', termEnd: '2027-02-20' };
    expect(resolveSyllabusDate('Jan 8', winter)).toBe('2027-01-08');
    expect(resolveSyllabusDate('Dec 18', winter)).toBe('2026-12-18');
  });

  it('falls back to the nearest year with no term to go on', () => {
    const loose = { today: '2026-09-21' };
    expect(resolveSyllabusDate('Sep 14', loose)).toBe('2026-09-14');
    expect(resolveSyllabusDate('Oct 2', loose)).toBe('2026-10-02');
    // Six months either side lands on whichever is closer, which for March is
    // the coming one.
    expect(resolveSyllabusDate('Mar 1', loose)).toBe('2027-03-01');
  });

  it('reads the day-first form too', () => {
    expect(resolveSyllabusDate('14 Sep', FALL)).toBe('2026-09-14');
  });

  it('answers nothing for a cell with no date in it', () => {
    expect(resolveSyllabusDate('', FALL)).toBeNull();
    expect(resolveSyllabusDate('TBD', FALL)).toBeNull();
    expect(resolveSyllabusDate('Week 4', FALL)).toBeNull();
  });

  it('is a function of its inputs, not of the clock', () => {
    // `today` is passed rather than read, so the same paste resolves the same
    // way whenever the test runs.
    const a = resolveSyllabusDate('Sep 14', FALL);
    const b = resolveSyllabusDate('Sep 14', { ...FALL, today: '2026-11-30' });
    expect(a).toBe('2026-09-14');
    expect(b).toBe('2026-09-14');
  });
});
