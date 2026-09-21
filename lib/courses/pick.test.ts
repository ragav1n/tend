import { describe, expect, it } from 'vitest';
import { pickCourse } from './pick';

const COURSES = [
  { id: 'crypto', code: 'CS 6260' },
  { id: 'incident', code: 'CS 6261' },
  { id: 'intro', code: 'CS 6035' },
  { id: 'policy', code: 'PUBP 6725' },
];

describe('pickCourse', () => {
  it('folds punctuation and case', () => {
    for (const typed of ['CS 6260', 'cs-6260', 'CS6260', 'cs6260']) {
      expect(pickCourse(typed, COURSES)).toBe('crypto');
    }
  });

  it('takes a prefix while only one thing could be meant', () => {
    expect(pickCourse('pubp', COURSES)).toBe('policy');
  });

  it('refuses an ambiguous prefix rather than guessing', () => {
    // Three courses start cs6, and filing work under the wrong one is worse
    // than leaving it in the Inbox.
    expect(pickCourse('cs6', COURSES)).toBeNull();
  });

  it('refuses a code nothing carries', () => {
    expect(pickCourse('math1554', COURSES)).toBeNull();
  });

  it('refuses an empty code', () => {
    expect(pickCourse('', COURSES)).toBeNull();
    expect(pickCourse('!!', COURSES)).toBeNull();
  });

  it('refuses two courses folding to the same code', () => {
    expect(pickCourse('cs6260', [...COURSES, { id: 'dupe', code: 'cs-6260' }])).toBeNull();
  });
});
