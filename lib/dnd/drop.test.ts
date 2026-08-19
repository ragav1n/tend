// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { targetFromStack } from './drop';

function grid(): { cells: Record<string, HTMLElement>; chip: HTMLElement } {
  const root = document.createElement('div');
  const cells: Record<string, HTMLElement> = {};

  for (const day of ['2026-08-20', '2026-08-21']) {
    const cell = document.createElement('div');
    cell.setAttribute('data-day', day);
    root.append(cell);
    cells[day] = cell;
  }

  const chip = document.createElement('div');
  cells['2026-08-20']!.append(chip);
  document.body.append(root);
  return { cells, chip };
}

describe('targetFromStack', () => {
  it('reads the day off the cell under the pointer', () => {
    const { cells, chip } = grid();
    expect(targetFromStack([cells['2026-08-21']!], chip, 'data-day')).toBe('2026-08-21');
  });

  it('skips the cell the dragged chip came from', () => {
    const { cells, chip } = grid();
    // The chip is on top of the stack and still parented by its own cell.
    expect(targetFromStack([chip, cells['2026-08-20']!, cells['2026-08-21']!], chip, 'data-day')).toBe(
      '2026-08-21',
    );
  });

  it('answers nothing when the drop landed off the grid', () => {
    const { chip } = grid();
    expect(targetFromStack([document.body], chip, 'data-day')).toBeNull();
  });

  it('finds the cell from a child element of it', () => {
    const { cells, chip } = grid();
    const label = document.createElement('span');
    cells['2026-08-21']!.append(label);
    expect(targetFromStack([label], chip, 'data-day')).toBe('2026-08-21');
  });
});
