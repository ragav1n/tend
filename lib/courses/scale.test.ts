import { describe, expect, it } from 'vitest';
import type { GradeBand } from '@/lib/db/types';
import { bandFor, DEFAULT_SCALE, letterFor, scaleFor, targetFor } from './scale';

describe('a grade scale', () => {
  it('falls back to the default when a course has none', () => {
    expect(scaleFor([])).toEqual(DEFAULT_SCALE);
  });

  it('prefers the course own scale', () => {
    const strict: GradeBand[] = [{ letter: 'A', min: 93, points: 4 }];
    expect(scaleFor(strict)).toEqual(strict);
    expect(letterFor(91, strict)).toBe('—');
  });

  it('reads a letter off a percentage', () => {
    expect(letterFor(95, [])).toBe('A');
    expect(letterFor(80, [])).toBe('B');
    expect(letterFor(0, [])).toBe('F');
  });

  it('takes the boundary as earning the band', () => {
    // 90 is an A, not a B. The band says "lowest percentage that earns it".
    expect(letterFor(90, [])).toBe('A');
    expect(letterFor(89.99, [])).toBe('B');
  });

  it('sorts the bands rather than trusting the stored order', () => {
    // The scale is editable, so a list saved out of order would otherwise award
    // whichever row happened to match first.
    const jumbled: GradeBand[] = [
      { letter: 'F', min: 0, points: 0 },
      { letter: 'A', min: 90, points: 4 },
      { letter: 'B', min: 80, points: 3 },
    ];
    expect(letterFor(95, jumbled)).toBe('A');
  });

  it('answers nothing when no band reaches that low', () => {
    const noFail: GradeBand[] = [{ letter: 'C', min: 70, points: 2 }];
    expect(bandFor(50, noFail)).toBeNull();
    expect(letterFor(50, noFail)).toBe('—');
  });

  it('gives the number a letter target means', () => {
    expect(targetFor('A', [])).toBe(90);
    expect(targetFor('a', [])).toBe(90);
    expect(targetFor('A+', [])).toBeNull();
  });

  it('carries the grade points a band is worth', () => {
    expect(bandFor(95, [])!.points).toBe(4);
    // Per band rather than derived, so a course counting an A as 4.3 needs no
    // new code.
    const generous: GradeBand[] = [{ letter: 'A', min: 90, points: 4.3 }];
    expect(bandFor(95, generous)!.points).toBe(4.3);
  });
});
