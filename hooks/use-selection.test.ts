import { beforeEach, describe, expect, it } from 'vitest';
import { useSelectionStore } from './use-selection';

/**
 * Selection across the lists on one page.
 *
 * `range.test.ts` holds what one click does to one list. What it cannot hold is
 * the part that was broken from the day selection shipped: with two lists
 * mounted, each pruned the picks against its own rows, so a pick in the logbook's
 * "Yesterday" was dropped the moment "Today" reported. Nobody saw it until the
 * keyboard cursor started walking past the first list.
 */

const state = () => useSelectionStore.getState();
const picked = () => [...state().ids].sort();

beforeEach(() => {
  useSelectionStore.setState({
    active: false,
    ids: new Set(),
    anchor: null,
    lists: new Map(),
    total: 0,
  });
});

describe('selection over several lists', () => {
  it('keeps a pick in one list when another reports', () => {
    state().report('today', ['a1', 'a2']);
    state().report('yesterday', ['b1']);

    state().pick('b1', ['b1'], false);
    expect(picked()).toEqual(['b1']);

    // The other list re-runs its query, which is what a tick anywhere on the
    // page causes. It knows nothing about b1 and must not speak for it.
    state().report('today', ['a1', 'a2']);
    expect(picked()).toEqual(['b1']);
  });

  it('drops a row that leaves the list it was picked in', () => {
    state().report('today', ['a1', 'a2']);
    state().pick('a1', ['a1', 'a2'], false);
    state().pick('a2', ['a1', 'a2'], false);

    state().report('today', ['a2']);
    expect(picked()).toEqual(['a2']);
  });

  it('holds the mode when one list of several unmounts', () => {
    state().report('today', ['a1']);
    state().report('yesterday', ['b1']);
    state().pick('a1', ['a1'], false);
    state().pick('b1', ['b1'], false);

    // A day group closing, or its last row moving to another day.
    state().forget('yesterday');

    expect(state().active).toBe(true);
    expect(picked()).toEqual(['a1']);
  });

  it('ends the mode when the page runs out of rows', () => {
    state().report('today', ['a1', 'a2']);
    state().selectAll();
    expect(state().active).toBe(true);

    // Both completed, so the list empties. An action bar reading "0 selected"
    // over an empty state is a mode nobody asked to still be in.
    state().report('today', []);

    expect(state().active).toBe(false);
    expect(picked()).toEqual([]);
  });

  it('holds the mode while one list still has rows', () => {
    state().report('today', ['a1']);
    state().report('yesterday', ['b1']);
    state().pick('b1', ['b1'], false);

    state().report('today', []);

    expect(state().active).toBe(true);
    expect(picked()).toEqual(['b1']);
  });

  it('ends the mode when the last list unmounts', () => {
    state().report('today', ['a1']);
    state().pick('a1', ['a1'], false);

    state().forget('today');

    expect(state().active).toBe(false);
    expect(picked()).toEqual([]);
    expect(state().total).toBe(0);
  });

  it('counts every row on the page', () => {
    state().report('today', ['a1', 'a2']);
    state().report('yesterday', ['b1']);
    expect(state().total).toBe(3);

    state().forget('today');
    expect(state().total).toBe(1);
  });

  it('selects every row on the page, not one list', () => {
    state().report('today', ['a1', 'a2']);
    state().report('yesterday', ['b1']);

    state().selectAll();

    expect(picked()).toEqual(['a1', 'a2', 'b1']);
    expect(state().anchor).toBe('a1');
  });

  it('refuses to start with no rows to select', () => {
    state().begin();
    expect(state().active).toBe(false);

    // A list showing its empty state registers too, and an action bar over an
    // empty screen can only ever read "0 selected".
    state().report('today', []);
    state().begin();
    expect(state().active).toBe(false);

    state().report('today', ['a1']);
    state().begin();
    expect(state().active).toBe(true);
  });

  it('leaves the set alone when a report prunes nothing', () => {
    state().report('today', ['a1', 'a2']);
    state().pick('a1', ['a1', 'a2'], false);
    const before = state().ids;

    state().report('today', ['a1', 'a2', 'a3']);

    // Identity, not contents. A fresh Set here re-renders every row on the page
    // on every tick of every live query.
    expect(state().ids).toBe(before);
  });

  it('spans one list with a shift-run, not the page', () => {
    state().report('today', ['a1', 'a2', 'a3']);
    state().report('yesterday', ['b1', 'b2']);

    state().pick('a1', ['a1', 'a2', 'a3'], false);
    // Shift-clicking into another group cannot mean "everything between", since
    // the two lists have no shared order. It picks the row and moves on.
    state().pick('b2', ['b1', 'b2'], true);

    expect(picked()).toEqual(['a1', 'b2']);
  });
});
