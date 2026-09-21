import type { CourseComponent, GradeBand, Task } from '@/lib/db/types';
import { bandFor } from './scale';

/**
 * Where a course actually stands, and what is still reachable.
 *
 * Everything here is pure and offline. A grade projection is arithmetic over
 * rows the device already holds, so it has no business asking the network, and
 * the whole point of the number is that it is there when you are deciding what
 * to work on.
 *
 * ── The one decision worth explaining ──────────────────────────────────────
 *
 * A component's weight is split by **points**, not by item count and not all at
 * once. If Homework is 30% and covers 500 points of which 200 are graded, then
 * 12% of the course is settled and 18% is still pending. Each point is worth
 * `weight / totalPossible`.
 *
 * The naive alternative treats a component as settled the moment anything in it
 * is graded, which reads two homeworks into a confident claim about all five.
 * The other naive alternative ignores pending work entirely, which makes the
 * final exam invisible to the one question people ask, "what do I need on the
 * final". Splitting by points answers that question directly, and it degrades
 * to the naive version on its own when nothing pending has a points value.
 *
 * A component with no items at all contributes nothing and is reported as
 * uncovered rather than counted as a zero. An untouched final is not a final you
 * failed, and that distinction is the difference between a projection somebody
 * trusts and one they learn to ignore.
 */

/** One component with the tasks filed under it. */
export interface ComponentWork {
  component: CourseComponent;
  tasks: readonly Task[];
}

export interface ComponentStanding {
  componentId: string;
  name: string;
  /** The component's share of the course, as written on the syllabus. */
  weight: number;
  /** Percentage across graded items, after `dropLowest`. Null when none are. */
  percent: number | null;
  gradedEarned: number;
  gradedPossible: number;
  /** Points entered but not yet graded. What a target is solved against. */
  pendingPossible: number;
  /** How many scores `dropLowest` actually threw away. */
  dropped: number;
  /** Weight already decided, and weight still to play for. */
  settledWeight: number;
  pendingWeight: number;
  /** Weight-points banked so far. `settledWeight` is the most this could be. */
  bankedWeight: number;
}

export interface CourseStanding {
  components: ComponentStanding[];
  /** Percentage over the work already graded. Null when nothing is. */
  current: number | null;
  /**
   * Percentage over everything with a points value, with pending work assumed
   * to go at `assumedRate`. Null when nothing is graded and no rate was given.
   */
  projected: number | null;
  /** The rate pending work was assumed to go at, as a percentage. */
  assumedRate: number | null;
  settledWeight: number;
  pendingWeight: number;
  /** Weight belonging to components with nothing entered. Unknowable, so it is
   *  excluded from both numbers above and said out loud instead. */
  uncoveredWeight: number;
  /** What the components sum to. Not forced to 100: extra credit goes past it
   *  and a half-entered syllabus falls short. */
  totalWeight: number;
  bankedWeight: number;
}

/** A graded item: it has a score and something to score out of. */
function isGraded(task: Task): boolean {
  return (
    task.pointsEarned !== null && task.pointsPossible !== null && task.pointsPossible > 0
  );
}

/** Entered but not marked yet. This is what makes a target solvable. */
function isPending(task: Task): boolean {
  return task.pointsEarned === null && task.pointsPossible !== null && task.pointsPossible > 0;
}

/**
 * One component's standing.
 *
 * `dropLowest` throws away the worst scores by percentage rather than by raw
 * points, or a 5-point quiz would always outrank a missed 100-point midterm.
 * It never drops the last score: dropping everything leaves a component that
 * claims to be graded and can say nothing, and "drop the lowest" on a syllabus
 * with one quiz so far means keep it.
 */
export function componentStanding({ component, tasks }: ComponentWork): ComponentStanding {
  const graded = tasks.filter(isGraded);
  const pending = tasks.filter(isPending);

  const byRate = [...graded].sort(
    (a, b) => a.pointsEarned! / a.pointsPossible! - b.pointsEarned! / b.pointsPossible!,
  );
  const dropped = Math.max(0, Math.min(component.dropLowest, byRate.length - 1));
  const kept = byRate.slice(dropped);

  const gradedEarned = kept.reduce((sum, task) => sum + task.pointsEarned!, 0);
  const gradedPossible = kept.reduce((sum, task) => sum + task.pointsPossible!, 0);
  const pendingPossible = pending.reduce((sum, task) => sum + task.pointsPossible!, 0);

  const totalPossible = gradedPossible + pendingPossible;
  const perPoint = totalPossible === 0 ? 0 : component.weight / totalPossible;

  return {
    componentId: component.id,
    name: component.name,
    weight: component.weight,
    percent: gradedPossible === 0 ? null : (gradedEarned / gradedPossible) * 100,
    gradedEarned,
    gradedPossible,
    pendingPossible,
    dropped,
    settledWeight: gradedPossible * perPoint,
    pendingWeight: pendingPossible * perPoint,
    bankedWeight: gradedEarned * perPoint,
  };
}

/**
 * The whole course.
 *
 * `assume` is the rate pending work is projected to go at, as a percentage. Left
 * out, it is the rate you are already going at, which is the only assumption the
 * data supports. Passing it is what makes the Grades tab's "what if I get 95% on
 * the rest" honest rather than a second formula.
 */
export function courseStanding(
  work: readonly ComponentWork[],
  assume?: number,
): CourseStanding {
  const components = work.map(componentStanding);

  const settledWeight = sum(components.map((c) => c.settledWeight));
  const pendingWeight = sum(components.map((c) => c.pendingWeight));
  const bankedWeight = sum(components.map((c) => c.bankedWeight));
  const totalWeight = sum(components.map((c) => c.weight));
  const uncoveredWeight = sum(
    components
      .filter((c) => c.gradedPossible === 0 && c.pendingPossible === 0)
      .map((c) => c.weight),
  );

  const current = settledWeight === 0 ? null : (bankedWeight / settledWeight) * 100;
  const assumedRate = assume ?? current;

  const covered = settledWeight + pendingWeight;
  const projected =
    covered === 0 || assumedRate === null
      ? current
      : ((bankedWeight + (pendingWeight * assumedRate) / 100) / covered) * 100;

  return {
    components,
    current,
    projected,
    assumedRate,
    settledWeight,
    pendingWeight,
    uncoveredWeight,
    totalWeight,
    bankedWeight,
  };
}

export type ReachVerdict = 'already' | 'needs' | 'impossible' | 'nothing-left';

export interface Reach {
  verdict: ReachVerdict;
  /** The percentage needed across pending work. Null unless the verdict needs
   *  one, and it can exceed 100, which is what makes it impossible. */
  required: number | null;
  /** The weight the requirement is spread over, so the UI can say "of the 40%
   *  still to come". */
  pendingWeight: number;
}

/**
 * What you need on what is left, to land on `target`.
 *
 * One linear equation, solved rather than searched:
 *
 *     target/100 × covered = banked + pending × required/100
 *
 * so `required = (target/100 × covered − banked) / pending × 100`.
 *
 * The target is read against the covered weight rather than against 100, which
 * is the honest reading while part of the syllabus has no points entered: it
 * answers "an A on the work I know about" instead of quietly assuming the
 * unentered final is free marks.
 *
 * Over 100 is reported as impossible rather than clamped. Somebody asking this
 * question deserves the real answer, and "you need 118%" is the answer.
 */
export function reachTarget(standing: CourseStanding, target: number): Reach {
  const { bankedWeight, settledWeight, pendingWeight } = standing;
  const covered = settledWeight + pendingWeight;

  if (pendingWeight === 0) {
    return { verdict: 'nothing-left', required: null, pendingWeight: 0 };
  }

  const needed = ((target / 100) * covered - bankedWeight) / pendingWeight * 100;

  if (needed <= 0) return { verdict: 'already', required: 0, pendingWeight };
  if (needed > 100) return { verdict: 'impossible', required: needed, pendingWeight };
  return { verdict: 'needs', required: needed, pendingWeight };
}

export interface CourseGrade {
  courseId: string;
  creditHours: number;
  /** The projected percentage, which is what a letter is read off. */
  percent: number | null;
  band: GradeBand | null;
}

/**
 * A term's GPA, from the projections.
 *
 * Courses with nothing graded are left out rather than counted as a zero, and
 * `counted` says how many made it in, because a 4.0 over one of five courses is
 * not a 4.0 and a number that does not admit that is worse than no number.
 */
export function termGpa(grades: readonly CourseGrade[]): {
  gpa: number | null;
  counted: number;
  credits: number;
} {
  const usable = grades.filter((grade) => grade.band !== null && grade.creditHours > 0);
  const credits = sum(usable.map((grade) => grade.creditHours));

  if (credits === 0) return { gpa: null, counted: 0, credits: 0 };

  const points = sum(usable.map((grade) => grade.band!.points * grade.creditHours));
  return { gpa: points / credits, counted: usable.length, credits };
}

/** The projected band for one course, ready for `termGpa`. */
export function courseGrade(
  courseId: string,
  creditHours: number,
  standing: CourseStanding,
  gradeScale: readonly GradeBand[],
): CourseGrade {
  const percent = standing.projected;
  return {
    courseId,
    creditHours,
    percent,
    band: percent === null ? null : bandFor(percent, gradeScale),
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
