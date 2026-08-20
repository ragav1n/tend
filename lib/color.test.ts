import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contrast, oklchToHex, themeTokens, type Oklch } from './color';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const THEMES = themeTokens(css);

const AA_TEXT = 4.5;
const AA_UI = 3.0;

type ThemeName = keyof typeof THEMES;
const NAMES: ThemeName[] = ['dark', 'light'];

function token(theme: ThemeName, name: string): Oklch {
  const t = THEMES[theme][name];
  if (!t) throw new Error(`--color-${name} missing from the ${theme} ramp in app/globals.css`);
  return t;
}

const RAMP = [
  'void', 'sunken', 'surface', 'raised',
  'clay-700', 'clay-600', 'clay-500', 'clay-400', 'clay-300', 'clay-200',
  'olive-700', 'olive-600', 'olive-500', 'olive-400', 'olive-300', 'olive-200',
  'sand-500', 'sand-400', 'sand-300', 'sand-200',
  'on-accent', 'text-hi', 'text-mid', 'text-lo', 'text-faint',
];

describe.each(NAMES)('the %s ramp parses', (theme) => {
  it('has every token', () => {
    for (const name of RAMP) expect(THEMES[theme][name], `--color-${name}`).toBeDefined();
  });
});

describe('the light ramp is a second measurement, not an inversion', () => {
  it('overrides every token the dark ramp defines', () => {
    // A token the light block forgets keeps its dark value and silently ships a
    // dark-theme colour on a white page. Only the two that are meant to be
    // shared are allowed through.
    const shared = new Set(['on-accent']);
    const same = RAMP.filter(
      (name) =>
        !shared.has(name) && oklchToHex(token('dark', name)) === oklchToHex(token('light', name)),
    );
    // The fills are deliberately identical across both. The source terracotta
    // and olive are dark enough to carry the same light text on either page, so
    // a primary button is the one element that looks the same in both themes.
    expect(same).toEqual(['clay-600', 'clay-500', 'olive-600', 'olive-500']);
  });

  it('keeps the cream that sits on an accent fill out of the flip', () => {
    expect(oklchToHex(token('dark', 'on-accent'))).toBe(oklchToHex(token('light', 'on-accent')));
  });
});

describe('the source palette survives in the dark ramp', () => {
  it('keeps all four supplied hexes', () => {
    // The whole point of the ramp design is that the user's palette survives
    // inside it. If any of these drift, the ramp stopped being their palette.
    expect(oklchToHex(token('dark', 'surface'))).toBe('#2B2D31'); // charcoal
    expect(oklchToHex(token('dark', 'clay-600'))).toBe('#8D321F'); // terracotta
    expect(oklchToHex(token('dark', 'sand-500'))).toBe('#C29B72'); // beige
    // Source olive #3A4027 is L 0.359; olive-600 sits at the ramp's 600 step.
    expect(oklchToHex(token('dark', 'olive-600'))).toBe('#505935');
  });

  it('keeps terracotta as the resting fill in the light ramp too', () => {
    expect(oklchToHex(token('light', 'clay-600'))).toBe('#8D321F');
  });
});

describe('the palette problem the dark ramp exists to solve', () => {
  it('confirms the raw source colors are unusable on charcoal', () => {
    // Documents why the ramp exists. If someone "simplifies" the tokens back to
    // the four raw hexes, these two assertions explain what breaks.
    const rawTerracotta: Oklch = { l: 0.446, c: 0.1279, h: 33.5 };
    const rawOlive: Oklch = { l: 0.3586, c: 0.0413, h: 119.5 };
    expect(contrast(rawTerracotta, token('dark', 'surface'))).toBeLessThan(2);
    expect(contrast(rawOlive, token('dark', 'surface'))).toBeLessThan(1.5);
  });
});

/**
 * The rules below hold in BOTH themes, because they are the rules the
 * components follow: a class name picks the step named for its job, and the job
 * is the same on either page.
 */
describe.each(NAMES)('%s: text on void, sunken and surface', (theme) => {
  const backgrounds = ['void', 'sunken', 'surface'] as const;

  it.each(backgrounds)('text-hi, text-mid and text-lo clear AA on %s', (bg) => {
    for (const fg of ['text-hi', 'text-mid', 'text-lo']) {
      expect(
        contrast(token(theme, fg), token(theme, bg)),
        `${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(backgrounds)('clay-300 and olive-300 clear AA on %s', (bg) => {
    expect(contrast(token(theme, 'clay-300'), token(theme, bg))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token(theme, 'olive-300'), token(theme, bg))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(backgrounds)('clay-400 clears the UI threshold on %s for borders and rings', (bg) => {
    expect(contrast(token(theme, 'clay-400'), token(theme, bg))).toBeGreaterThanOrEqual(AA_UI);
    expect(contrast(token(theme, 'olive-400'), token(theme, bg))).toBeGreaterThanOrEqual(AA_UI);
  });
});

describe.each(NAMES)('%s: what raised is allowed to carry', (theme) => {
  it('text-mid and the 200 accents clear AA there', () => {
    expect(contrast(token(theme, 'text-mid'), token(theme, 'raised'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token(theme, 'clay-200'), token(theme, 'raised'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token(theme, 'olive-200'), token(theme, 'raised'))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('raised is the dark ramp’s trap, and only the dark ramp’s', () => {
  it('text-lo and the 300 accents FAIL on dark raised, which is why the step exists', () => {
    expect(contrast(token('dark', 'text-lo'), token('dark', 'raised'))).toBeLessThan(AA_TEXT);
    expect(contrast(token('dark', 'clay-300'), token('dark', 'raised'))).toBeLessThan(AA_TEXT);
    expect(contrast(token('dark', 'olive-300'), token('dark', 'raised'))).toBeLessThan(AA_TEXT);
  });

  it('and they all pass on light raised, because raised steps down there', () => {
    // Elevation still means closer to the light, but the page is already near
    // white, so a control inside a card gets darker rather than lighter.
    expect(token('light', 'raised').l).toBeLessThan(token('light', 'surface').l);
    expect(contrast(token('light', 'text-lo'), token('light', 'raised'))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(token('light', 'clay-300'), token('light', 'raised'))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe.each(NAMES)('%s: text on the accent fills', (theme) => {
  it('on-accent clears AA on clay-600, clay-500 and olive-600', () => {
    for (const fill of ['clay-600', 'clay-500', 'olive-600']) {
      expect(
        contrast(token(theme, 'on-accent'), token(theme, fill)),
        `on-accent on ${fill}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('sand is a fill in one ramp and a text colour in the other', () => {
  /*
   * The rule the old single-ramp test encoded was "text on a sand fill is
   * `void`, never `text-hi`", which held because sand-500 was light. In the
   * light ramp it is a mid-dark accent instead, so that pairing inverts. Both
   * are asserted here rather than dropped: nothing puts text on sand today, and
   * the next component that does should find the answer written down.
   */
  it('never takes text-hi, in either ramp, for opposite reasons', () => {
    // Dark ramp: sand-500 is a light fill and text-hi is cream, so they collide.
    // Light ramp: sand-500 is a dark fill and text-hi is near black, so they
    // collide the other way. One ban, two causes.
    for (const theme of NAMES) {
      expect(
        contrast(token(theme, 'text-hi'), token(theme, 'sand-500')),
        `text-hi on ${theme} sand-500`,
      ).toBeLessThan(AA_TEXT);
    }
  });

  it('takes void in the dark ramp and on-accent in the light one', () => {
    expect(contrast(token('dark', 'void'), token('dark', 'sand-500'))).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(
      contrast(token('light', 'on-accent'), token('light', 'sand-500')),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('reads as text on the page in both, at the step meant for it', () => {
    for (const theme of NAMES) {
      expect(
        contrast(token(theme, 'sand-300'), token(theme, 'surface')),
        `sand-300 on ${theme} surface`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe.each(NAMES)('%s: text-faint is decoration', (theme) => {
  it('clears nothing anywhere, which is why it is banned from real text', () => {
    for (const bg of ['void', 'sunken', 'surface', 'raised']) {
      expect(contrast(token(theme, 'text-faint'), token(theme, bg)), `on ${bg}`).toBeLessThan(
        AA_TEXT,
      );
    }
  });
});

describe('the dark neutral ramp climbs in even steps', () => {
  it('void < sunken < surface < raised', () => {
    const ls = ['void', 'sunken', 'surface', 'raised'].map((n) => token('dark', n).l);
    for (let i = 1; i < ls.length; i++) expect(ls[i]!).toBeGreaterThan(ls[i - 1]!);
  });
});

describe('the light neutral ramp puts the page under the cards', () => {
  it('sunken < raised < void < surface', () => {
    const ls = ['sunken', 'raised', 'void', 'surface'].map((n) => token('light', n).l);
    for (let i = 1; i < ls.length; i++) expect(ls[i]!).toBeGreaterThan(ls[i - 1]!);
  });
});

describe.each(NAMES)('%s: the neutrals hold one hue', (theme) => {
  it('so nothing looks tinted against its neighbour', () => {
    const hues = new Set(
      ['void', 'sunken', 'surface', 'raised'].map((n) => token(theme, n).h),
    );
    expect(hues.size).toBe(1);
    for (const n of ['void', 'sunken', 'surface', 'raised']) {
      expect(token(theme, n).c, `${n} chroma`).toBeLessThan(0.015);
    }
  });
});
