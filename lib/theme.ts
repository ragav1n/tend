/**
 * Which ramp the app is wearing.
 *
 * A device preference, not an account one, so it lives in localStorage rather
 * than in synced settings. A phone in a dark bedroom and a laptop under an
 * office light are the same person making two different choices, and syncing
 * this would mean one of those two is always wrong.
 *
 * The chosen theme resolves to an attribute on `<html>`, which is what the
 * `[data-theme='light']` block in globals.css hangs off. Nothing here touches
 * React: the first paint has to be correct, and React has not run yet.
 */

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'tend.theme';

/** Matches --color-void in each ramp, so the iOS status bar and the Android
 *  chrome blend into the page instead of banding against it. */
export const THEME_COLOR: Record<Theme, string> = {
  dark: '#111316',
  light: '#F8F4EF',
};

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveTheme(pref: ThemePref, prefersDark: boolean): Theme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light';
  return pref;
}

/**
 * The script that runs before the first paint.
 *
 * Inlined in the document head as a string, because a module import would land
 * after the first frame and the page would flash the wrong ramp. It is written
 * as a string rather than compiled from a function so what ships is exactly
 * what is read here.
 *
 * Dark is the fallback for a browser with no `matchMedia` and for a value that
 * has been tampered with, because dark is what the app looked like before this
 * existed.
 */
export const THEME_SCRIPT = `
(function () {
  try {
    var pref = localStorage.getItem(${JSON.stringify(THEME_KEY)});
    if (pref !== 'light' && pref !== 'dark' && pref !== 'system') pref = 'system';
    var dark = pref === 'dark' ||
      (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? ${JSON.stringify(THEME_COLOR.dark)} : ${JSON.stringify(THEME_COLOR.light)});
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
`.trim();

/** Paints a resolved theme onto the document. Safe to call on every change. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  // Kept in step by hand rather than through the viewport export, because the
  // metadata version can only follow the OS setting and this can be overridden.
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', THEME_COLOR[theme]);
}

export function readThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isThemePref(stored) ? stored : 'system';
  } catch {
    // Private mode with storage blocked. The app still works, it just forgets.
    return 'system';
  }
}

export function writeThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Same as above: a theme that does not persist beats a crash.
  }
}
