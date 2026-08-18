import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contrast, extractColorTokens, oklchToHex, type Oklch } from './color';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const T = extractColorTokens(css);

function token(name: string): Oklch {
  const t = T[name];
  if (!t) throw new Error(`token --color-${name} missing from app/globals.css`);
  return t;
}

const AA_TEXT = 4.5;
const AA_UI = 3.0;

describe('token block parses', () => {
  it('finds every ramp', () => {
    for (const name of [
      'void', 'sunken', 'surface', 'raised',
      'clay-700', 'clay-600', 'clay-500', 'clay-400', 'clay-300', 'clay-200',
      'olive-700', 'olive-600', 'olive-500', 'olive-400', 'olive-300', 'olive-200',
      'sand-500', 'sand-400', 'sand-300', 'sand-200',
      'text-hi', 'text-mid', 'text-lo', 'text-faint',
    ]) {
      expect(T[name], `--color-${name}`).toBeDefined();
    }
  });

  it('keeps all four source hexes from the supplied palette', () => {
    // The whole point of the ramp design is that the user's palette survives
    // inside it. If any of these drift, the ramp stopped being their palette.
    expect(oklchToHex(token('surface'))).toBe('#2B2D31'); // charcoal
    expect(oklchToHex(token('clay-600'))).toBe('#8D321F'); // terracotta
    expect(oklchToHex(token('sand-500'))).toBe('#C29B72'); // beige
    // Source olive #3A4027 is L 0.359; olive-600 sits at the ramp's 600 step.
    expect(oklchToHex(token('olive-600'))).toBe('#505935');
  });
});

describe('the palette problem this ramp exists to solve', () => {
  it('confirms the raw source colors are unusable on charcoal', () => {
    // Documents why the ramp exists. If someone "simplifies" the tokens back to
    // the four raw hexes, these two assertions explain what breaks.
    const rawTerracotta: Oklch = { l: 0.446, c: 0.1279, h: 33.5 };
    const rawOlive: Oklch = { l: 0.3586, c: 0.0413, h: 119.5 };
    expect(contrast(rawTerracotta, token('surface'))).toBeLessThan(2);
    expect(contrast(rawOlive, token('surface'))).toBeLessThan(1.5);
  });
});

describe('text on void, sunken and surface', () => {
  const backgrounds = ['void', 'sunken', 'surface'] as const;

  it.each(backgrounds)('text-hi, text-mid and text-lo clear AA on %s', (bg) => {
    for (const fg of ['text-hi', 'text-mid', 'text-lo']) {
      expect(contrast(token(fg), token(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(backgrounds)('clay-300 and olive-300 clear AA on %s', (bg) => {
    expect(contrast(token('clay-300'), token(bg))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token('olive-300'), token(bg))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(backgrounds)('clay-400 clears the UI threshold on %s for borders and rings', (bg) => {
    expect(contrast(token('clay-400'), token(bg))).toBeGreaterThanOrEqual(AA_UI);
  });
});

describe('raised needs a step up, which is the easiest rule to forget', () => {
  it('text-lo FAILS on raised, so body text there must be text-mid', () => {
    expect(contrast(token('text-lo'), token('raised'))).toBeLessThan(AA_TEXT);
    expect(contrast(token('text-mid'), token('raised'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('the 300 accents FAIL on raised, so accent text there must be the 200s', () => {
    expect(contrast(token('clay-300'), token('raised'))).toBeLessThan(AA_TEXT);
    expect(contrast(token('olive-300'), token('raised'))).toBeLessThan(AA_TEXT);
    expect(contrast(token('clay-200'), token('raised'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token('olive-200'), token('raised'))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('text on the accent fills', () => {
  it('text-hi clears AA on clay-600 and olive-600', () => {
    expect(contrast(token('text-hi'), token('clay-600'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token('text-hi'), token('olive-600'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('sand-500 is light, so text on it is void rather than text-hi', () => {
    expect(contrast(token('text-hi'), token('sand-500'))).toBeLessThan(AA_TEXT);
    expect(contrast(token('void'), token('sand-500'))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('text-faint is decoration', () => {
  it('clears nothing anywhere, which is why it is banned from real text', () => {
    for (const bg of ['void', 'sunken', 'surface', 'raised']) {
      expect(contrast(token('text-faint'), token(bg)), `on ${bg}`).toBeLessThan(AA_TEXT);
    }
  });
});

describe('the neutral ramp climbs in even steps', () => {
  it('void < sunken < surface < raised', () => {
    const ls = ['void', 'sunken', 'surface', 'raised'].map((n) => token(n).l);
    for (let i = 1; i < ls.length; i++) {
      expect(ls[i]!).toBeGreaterThan(ls[i - 1]!);
    }
  });

  it('holds one hue across the neutrals so nothing looks tinted against its neighbour', () => {
    for (const n of ['void', 'sunken', 'surface', 'raised']) {
      expect(token(n).h).toBe(264);
      expect(token(n).c).toBeLessThan(0.015);
    }
  });
});
