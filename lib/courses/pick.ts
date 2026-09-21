/**
 * Which course a typed `+code` meant.
 *
 * Two callers, and they had grown their own copy each: quick-add resolves
 * against Dexie, and the inbound-mail route resolves against Postgres, because
 * a route cannot reach the local database. The algorithm is the same question
 * either way, and two copies of a matching rule is how a task typed on a phone
 * and the same task mailed in end up on different courses.
 *
 * Distinct from `matchCourse` in `feed.ts`, which is a different question: that
 * one reads a string Canvas wrote, so it has to cope with `CS-6260-A` and with
 * a feed label somebody set by hand. This one reads what a person typed.
 *
 * Exact first, then a unique prefix, so `+cs6` reaches CS 6035 while it is the
 * only thing it could be and resolves to nothing the day a second CS 6xxx is
 * added. Ambiguity is null rather than a coin flip: filing work under the wrong
 * course is worse than leaving it in the Inbox where it is visible.
 */

export interface PickableCourse {
  id: string;
  code: string;
}

/** Letters and digits only, so `CS 6260`, `cs-6260` and `CS6260` are one thing. */
export function fold(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function pickCourse(code: string, courses: readonly PickableCourse[]): string | null {
  const wanted = fold(code);
  if (wanted === '') return null;

  const exact = courses.filter((course) => fold(course.code) === wanted);
  if (exact.length === 1) return exact[0]!.id;
  // Two courses folding to the same code is a data problem, not a guess to make.
  if (exact.length > 1) return null;

  const starts = courses.filter((course) => fold(course.code).startsWith(wanted));
  return starts.length === 1 ? starts[0]!.id : null;
}
