import { describe, expect, it } from 'vitest';
import type { Task } from '@/lib/db/types';
import { nestedUnder } from './nest';

/**
 * The "a task appears once" rule, in isolation.
 *
 * It is two lines inside `TaskList` and it holds an invariant a screenshot
 * cannot show: a row rendered twice looks like a list with two similar rows in
 * it, and the tell is a keyboard cursor that stops on the same task twice.
 */

const child = (id: string): Task => ({ id }) as Task;

describe('nestedUnder', () => {
  it('nests every child when the list shows none of them', () => {
    const rendered = new Set(['parent']);
    expect(nestedUnder([child('a'), child('b')], rendered).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('leaves out the child the list already has a row for', () => {
    // 'a' was surfaced because its deadline is not its parent's, so the group
    // under the parent is the rest.
    const rendered = new Set(['parent', 'a']);
    expect(nestedUnder([child('a'), child('b')], rendered).map((t) => t.id)).toEqual(['b']);
  });

  it('answers with nothing for a parent that has no children', () => {
    expect(nestedUnder(undefined, new Set(['parent']))).toEqual([]);
  });
});
