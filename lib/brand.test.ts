import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  INK_FRACTION_MASKABLE,
  MARK_BAR,
  MARK_INK_TOKEN,
  MARK_SIZE,
  MARK_STEM,
  MARK_TILE_TOKEN,
} from './brand';
import { contrast, extractColorTokens } from './color';

/**
 * Every command in both paths takes coordinate pairs, so the numbers pair off
 * as x,y. Control points count: a curve cannot leave its own hull, so the hull
 * box is a safe stand-in for the real ink box and needs no bezier solving.
 */
function inkBox(...paths: string[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const path of paths) {
    const numbers = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    expect(numbers.length % 2, `${path} has an odd number of coordinates`).toBe(0);
    for (let i = 0; i < numbers.length; i += 2) {
      const [x, y] = [numbers[i], numbers[i + 1]];
      if (x === undefined || y === undefined) throw new Error(`${path} has a dangling coordinate`);
      xs.push(x);
      ys.push(y);
    }
  }
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const topEdge = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left, right, top: topEdge, bottom, width: right - left, height: bottom - topEdge };
}

describe('the mark sits centred on its grid', () => {
  // Everything downstream scales the 96 grid about its middle: the React tile,
  // every PNG, the maskable safe zone. If the ink drifts off centre here it
  // drifts in all of them at once, and it shows first on the smallest icon.
  const box = inkBox(MARK_STEM, MARK_BAR);

  it('centres the ink horizontally', () => {
    expect((box.left + box.right) / 2).toBeCloseTo(MARK_SIZE / 2, 1);
  });

  it('centres the ink vertically', () => {
    expect((box.top + box.bottom) / 2).toBeCloseTo(MARK_SIZE / 2, 1);
  });

  it('leaves the ink taller than it is wide, the way a lowercase t reads', () => {
    expect(box.height).toBeGreaterThan(box.width);
  });

  it('keeps the ink inside the grid', () => {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(MARK_SIZE);
    expect(box.bottom).toBeLessThanOrEqual(MARK_SIZE);
  });
});

describe('the maskable icon survives the launcher crop', () => {
  it('fits the ink inside the centred 80% safe circle', () => {
    // Android crops a maskable icon to a circle of 80% diameter, so the corner
    // of the ink box has to sit inside a radius of 0.4 of the tile.
    const box = inkBox(MARK_STEM, MARK_BAR);
    const inkHeight = INK_FRACTION_MASKABLE;
    const inkWidth = (box.width / box.height) * inkHeight;
    const cornerRadius = Math.hypot(inkWidth / 2, inkHeight / 2);
    expect(cornerRadius).toBeLessThan(0.4);
  });
});

describe('the mark is legible in the colours it ships in', () => {
  const tokens = extractColorTokens(readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8'));

  function token(name: string) {
    const found = tokens[name];
    if (!found) throw new Error(`token --color-${name} missing from app/globals.css`);
    return found;
  }

  it('clears AA for the ink on the tile', () => {
    // clay-600 is a fill-only step everywhere else in the app. It carries the
    // mark because the ink on top of it is text-hi, which measures 7.16:1.
    expect(contrast(token(MARK_INK_TOKEN), token(MARK_TILE_TOKEN))).toBeGreaterThanOrEqual(4.5);
  });
});
