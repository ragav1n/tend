import type { GradeBand } from '@/lib/db/types';

/**
 * Turning a percentage into a letter.
 *
 * A scale belongs to a course, because a seminar graded A/B/C and a lab graded
 * on 93 are both normal and a single global scale would make one of them wrong.
 * This is the fallback for a course that has not said, and it is the shape most
 * syllabi use.
 *
 * `min` is the lowest percentage that earns the band, and `points` is what it is
 * worth on a 4.0 scale. Both are per band rather than derived, so a course that
 * grades A at 93 or counts an A as 4.3 needs no new code.
 */
export const DEFAULT_SCALE: GradeBand[] = [
  { letter: 'A', min: 90, points: 4 },
  { letter: 'B', min: 80, points: 3 },
  { letter: 'C', min: 70, points: 2 },
  { letter: 'D', min: 60, points: 1 },
  { letter: 'F', min: 0, points: 0 },
];

/** The course's own scale, or the default when it has none. */
export function scaleFor(gradeScale: readonly GradeBand[]): GradeBand[] {
  return gradeScale.length > 0 ? [...gradeScale] : [...DEFAULT_SCALE];
}

/**
 * The band a percentage falls in.
 *
 * Sorted here rather than trusting the stored order: the scale is editable, and
 * a band list saved out of order would otherwise award the first row that
 * happened to match. Null only when the scale has no band low enough, which a
 * scale without an F does.
 */
export function bandFor(percent: number, gradeScale: readonly GradeBand[]): GradeBand | null {
  const bands = scaleFor(gradeScale).sort((a, b) => b.min - a.min);
  return bands.find((band) => percent >= band.min) ?? null;
}

/** The letter alone, or a dash when nothing in the scale reaches down that far. */
export function letterFor(percent: number, gradeScale: readonly GradeBand[]): string {
  return bandFor(percent, gradeScale)?.letter ?? '—';
}

/**
 * The lowest percentage that still earns a given letter.
 *
 * What a target picker needs: "I want an A" is a question about a number, and
 * the number is a property of this course's scale rather than of the letter.
 */
export function targetFor(letter: string, gradeScale: readonly GradeBand[]): number | null {
  const band = scaleFor(gradeScale).find(
    (each) => each.letter.toLowerCase() === letter.toLowerCase(),
  );
  return band ? band.min : null;
}
