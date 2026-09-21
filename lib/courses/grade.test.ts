import { describe, expect, it } from 'vitest';
import type { CourseComponent, Task } from '@/lib/db/types';
import {
  componentStanding,
  courseGrade,
  courseStanding,
  reachTarget,
  termGpa,
  type ComponentWork,
} from './grade';
import { DEFAULT_SCALE } from './scale';

/**
 * The arithmetic, against a semester that looks like one.
 *
 * The cases that matter are the ones where a wrong answer is plausible: nothing
 * graded yet, a component half marked, a dropped quiz, weights that do not sum
 * to 100, and a target that has already gone. Every one of those is a number
 * somebody would act on.
 */

let n = 0;
function component(over: Partial<CourseComponent> = {}): CourseComponent {
  n += 1;
  return {
    id: `component-${n}`,
    name: `Component ${n}`,
    weight: 0,
    dropLowest: 0,
    courseId: 'course-1',
    sortKey: 'a0',
    userId: 'local',
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    rowVersion: 0,
    _del: 0,
    ...over,
  };
}

/** A scored item, or a pending one when `earned` is null. */
function item(possible: number, earned: number | null): Task {
  n += 1;
  return {
    id: `task-${n}`,
    pointsPossible: possible,
    pointsEarned: earned,
  } as unknown as Task;
}

const work = (comp: Partial<CourseComponent>, tasks: Task[]): ComponentWork => ({
  component: component(comp),
  tasks,
});

describe('one component', () => {
  it('reads a percentage off what is graded', () => {
    const out = componentStanding(work({ weight: 30 }, [item(100, 90), item(100, 80)]));
    expect(out.percent).toBe(85);
    expect(out.gradedEarned).toBe(170);
    expect(out.gradedPossible).toBe(200);
  });

  it('answers nothing for a component with no marks yet', () => {
    // Not a zero. An untouched final is not a final you failed, and this is the
    // difference between a projection somebody trusts and one they ignore.
    const out = componentStanding(work({ weight: 40 }, [item(100, null)]));
    expect(out.percent).toBeNull();
    expect(out.bankedWeight).toBe(0);
    expect(out.pendingWeight).toBe(40);
  });

  it('splits the weight by points rather than by item', () => {
    // 30% over 500 points, 200 of them graded: 12% settled, 18% still to play
    // for. Treating the component as settled because something in it is marked
    // would read two homeworks as a claim about all five.
    const out = componentStanding(
      work({ weight: 30 }, [item(100, 100), item(100, 80), item(300, null)]),
    );
    expect(out.settledWeight).toBeCloseTo(12);
    expect(out.pendingWeight).toBeCloseTo(18);
    expect(out.bankedWeight).toBeCloseTo(10.8);
  });

  it('drops the worst score by rate, not by raw points', () => {
    // A missed 5-point quiz is not worse than a bad midterm.
    const out = componentStanding(
      work({ weight: 20, dropLowest: 1 }, [item(5, 0), item(100, 70)]),
    );
    expect(out.dropped).toBe(1);
    expect(out.percent).toBe(70);
  });

  it('never drops the only score there is', () => {
    // "Drop the lowest" on a syllabus with one quiz so far means keep it, or the
    // component claims to be graded and can say nothing.
    const out = componentStanding(work({ weight: 20, dropLowest: 2 }, [item(100, 60)]));
    expect(out.dropped).toBe(0);
    expect(out.percent).toBe(60);
  });

  it('ignores an item worth no points', () => {
    const out = componentStanding(work({ weight: 10 }, [item(0, 0), item(100, 90)]));
    expect(out.percent).toBe(90);
  });
});

describe('a whole course', () => {
  /** Homework 30 (half marked), Midterm 30 (marked), Final 40 (entered, not marked). */
  const semester = (): ComponentWork[] => [
    work({ weight: 30, name: 'Homework' }, [item(100, 90), item(100, 84), item(200, null)]),
    work({ weight: 30, name: 'Midterm' }, [item(100, 78)]),
    work({ weight: 40, name: 'Final' }, [item(100, null)]),
  ];

  it('reads current standing off the graded work alone', () => {
    const out = courseStanding(semester());
    // Homework: 174/200 over 15% settled. Midterm: 78/100 over 30%.
    // banked = 13.05 + 23.4 = 36.45 over settled 45.
    expect(out.settledWeight).toBeCloseTo(45);
    expect(out.bankedWeight).toBeCloseTo(36.45);
    expect(out.current).toBeCloseTo(81);
  });

  it('projects the rest at the rate you are already going', () => {
    const out = courseStanding(semester());
    // Nothing else is known, so pending goes at the current 81%, which lands
    // the projection on the current number.
    expect(out.assumedRate).toBeCloseTo(81);
    expect(out.projected).toBeCloseTo(81);
    expect(out.pendingWeight).toBeCloseTo(55);
  });

  it('projects the rest at a rate you name instead', () => {
    const out = courseStanding(semester(), 95);
    // banked 36.45 + 55% of the course at 95% = 36.45 + 52.25 = 88.7 over 100.
    expect(out.projected).toBeCloseTo(88.7);
  });

  it('says nothing at all before the first mark', () => {
    const out = courseStanding([
      work({ weight: 50 }, [item(100, null)]),
      work({ weight: 50 }, [item(100, null)]),
    ]);
    expect(out.current).toBeNull();
    expect(out.projected).toBeNull();
    expect(out.settledWeight).toBe(0);
  });

  it('keeps a component with nothing entered out of both numbers', () => {
    const out = courseStanding([
      work({ weight: 60, name: 'Marked' }, [item(100, 90)]),
      work({ weight: 40, name: 'Not entered' }, []),
    ]);
    // 90% on the 60% that exists, and the other 40% is said out loud rather
    // than counted as a zero or as free marks.
    expect(out.current).toBe(90);
    expect(out.projected).toBe(90);
    expect(out.uncoveredWeight).toBe(40);
    expect(out.totalWeight).toBe(100);
  });

  it('handles weights that sum past 100', () => {
    // Extra credit. Refusing the row would mean you cannot record the course.
    const out = courseStanding([
      work({ weight: 100 }, [item(100, 80)]),
      work({ weight: 5, name: 'Extra credit' }, [item(10, 10)]),
    ]);
    expect(out.totalWeight).toBe(105);
    expect(out.current).toBeCloseTo((80 + 5) / 105 * 100);
  });

  it('handles weights that fall short of 100', () => {
    const out = courseStanding([work({ weight: 30 }, [item(100, 90)])]);
    expect(out.totalWeight).toBe(30);
    expect(out.current).toBe(90);
  });

  it('answers for a course with no components at all', () => {
    const out = courseStanding([]);
    expect(out.current).toBeNull();
    expect(out.projected).toBeNull();
    expect(out.totalWeight).toBe(0);
  });
});

describe('what you need on the rest', () => {
  const halfway = () =>
    courseStanding([
      work({ weight: 60, name: 'Graded' }, [item(100, 85)]),
      work({ weight: 40, name: 'Final' }, [item(100, null)]),
    ]);

  it('solves the percentage needed to land on a target', () => {
    // 51 banked of 60. An A at 90 needs 90 − 51 = 39 out of the 40 left.
    const out = reachTarget(halfway(), 90);
    expect(out.verdict).toBe('needs');
    expect(out.required).toBeCloseTo(97.5);
    expect(out.pendingWeight).toBeCloseTo(40);
  });

  it('says so when the target is already secured', () => {
    const out = reachTarget(halfway(), 40);
    expect(out.verdict).toBe('already');
  });

  it('says so when the target has gone, and by how much', () => {
    // Reported rather than clamped. "You need 118%" is the real answer.
    const out = reachTarget(halfway(), 99);
    expect(out.verdict).toBe('impossible');
    expect(out.required!).toBeGreaterThan(100);
  });

  it('says so when there is nothing left to earn on', () => {
    const settled = courseStanding([work({ weight: 100 }, [item(100, 70)])]);
    const out = reachTarget(settled, 90);
    expect(out.verdict).toBe('nothing-left');
    expect(out.required).toBeNull();
  });

  it('agrees with the projection it was solved against', () => {
    // The two formulas have to be the same statement. Project at the rate the
    // target demands and the projection must land on the target.
    const standing = halfway();
    const reach = reachTarget(standing, 90);
    const projected = courseStanding(
      [
        work({ weight: 60, name: 'Graded' }, [item(100, 85)]),
        work({ weight: 40, name: 'Final' }, [item(100, null)]),
      ],
      reach.required!,
    );
    expect(projected.projected).toBeCloseTo(90);
  });
});

describe('a term GPA', () => {
  const graded = (id: string, credits: number, percent: number) =>
    courseGrade(
      id,
      credits,
      courseStanding([work({ weight: 100 }, [item(100, percent)])]),
      DEFAULT_SCALE,
    );

  it('weights each course by its credit hours', () => {
    const out = termGpa([graded('a', 3, 95), graded('b', 1, 65)]);
    // A is 4.0 over 3 credits, D is 1.0 over 1: 13 points over 4 credits.
    expect(out.gpa).toBeCloseTo(3.25);
    expect(out.credits).toBe(4);
    expect(out.counted).toBe(2);
  });

  it('leaves out a course with nothing graded rather than scoring it zero', () => {
    const ungraded = courseGrade(
      'c',
      3,
      courseStanding([work({ weight: 100 }, [item(100, null)])]),
      DEFAULT_SCALE,
    );
    const out = termGpa([graded('a', 3, 95), ungraded]);
    expect(out.gpa).toBe(4);
    // And it admits how little it is speaking for, because a 4.0 over one of
    // two courses is not a 4.0.
    expect(out.counted).toBe(1);
    expect(out.credits).toBe(3);
  });

  it('answers nothing for a term with no graded credits', () => {
    expect(termGpa([])).toEqual({ gpa: null, counted: 0, credits: 0 });
  });

  it('ignores a zero-credit course', () => {
    const out = termGpa([graded('a', 3, 95), graded('seminar', 0, 60)]);
    expect(out.gpa).toBe(4);
    expect(out.counted).toBe(1);
  });
});
