/**
 * OKLCH to sRGB conversion and WCAG relative luminance.
 *
 * This exists so `color.test.ts` can parse the token block in `app/globals.css`
 * and re-assert every contrast pair. The palette we were given does not work
 * raw (terracotta on charcoal measures 1.71:1), so the ramp that fixes it is
 * load-bearing and needs a test standing behind it rather than a comment.
 *
 * Conversion follows Björn Ottosson's OKLab reference. Out-of-gamut results are
 * clipped per channel, which matches what a browser does closely enough for
 * contrast checks on in-gamut tokens.
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

function gamma(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function ungamma(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** OKLCH to gamma-encoded sRGB, each channel clipped to 0..1. */
export function oklchToSrgb({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const r = 4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp;
  const g = -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp;
  const bl = -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp;

  const clip = (x: number) => Math.min(1, Math.max(0, gamma(x)));
  return [clip(r), clip(g), clip(bl)];
}

export function oklchToHex(color: Oklch): string {
  return (
    '#' +
    oklchToSrgb(color)
      .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** WCAG 2.1 relative luminance. */
export function luminance(color: Oklch): number {
  const [r, g, b] = oklchToSrgb(color).map(ungamma) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Oklch, b: Oklch): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const OKLCH_RE = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/;

/** Parse a bare `oklch(L C H)` value. Returns null for anything else, including
 *  the `color-mix()` hairline tokens, which have no fixed luminance to test. */
export function parseOklch(value: string): Oklch | null {
  const m = OKLCH_RE.exec(value);
  if (!m) return null;
  const [, l, c, h] = m as unknown as [string, string, string, string];
  return { l: Number(l), c: Number(c), h: Number(h) };
}

/** Pull every `--color-*: oklch(...)` declaration out of a CSS source string. */
export function extractColorTokens(css: string): Record<string, Oklch> {
  const out: Record<string, Oklch> = {};
  const re = /--color-([\w-]+):\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const name = m[1];
    const raw = m[2];
    if (name === undefined || raw === undefined) continue;
    const parsed = parseOklch(raw);
    if (parsed) out[name] = parsed;
  }
  return out;
}

/**
 * The body of the first block with this header, brace-balanced.
 *
 * The token regex above scans a whole file and lets the last declaration win,
 * which was fine while there was one ramp. With two, `--color-text-hi` appears
 * twice with opposite values, so anything that wants one theme has to say
 * which. The icon generator is the caller that would otherwise silently start
 * drawing a near-black mark.
 */
export function extractBlock(css: string, header: string): string | null {
  const start = css.indexOf(header);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return css.slice(start + header.length, i);
    }
  }
  return null;
}

const DARK_HEADER = '@theme {';
const LIGHT_HEADER = "[data-theme='light'] {";

/**
 * Both ramps, resolved.
 *
 * Light is the base tokens with its overrides applied, which mirrors what the
 * cascade does: a token the light block does not mention keeps its dark value,
 * and that is exactly the kind of omission a test should be able to catch.
 */
export function themeTokens(css: string): { dark: Record<string, Oklch>; light: Record<string, Oklch> } {
  const dark = extractColorTokens(extractBlock(css, DARK_HEADER) ?? '');
  const overrides = extractColorTokens(extractBlock(css, LIGHT_HEADER) ?? '');
  return { dark, light: { ...dark, ...overrides } };
}
