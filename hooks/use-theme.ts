'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  applyTheme,
  readThemePref,
  resolveTheme,
  writeThemePref,
  type Theme,
  type ThemePref,
} from '@/lib/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The theme, for anything that needs to know or change it.
 *
 * `useSyncExternalStore` rather than state seeded in an effect, because the
 * source of truth is outside React: localStorage plus a media query, both of
 * which the inline script in the document head has already read by the time
 * this mounts. Seeding from an effect would also be a setState per mount, which
 * `react-hooks/set-state-in-effect` rejects here.
 *
 * The snapshot is a string so React's identity check compares by value. An
 * object would be a fresh reference on every call and would loop.
 */

/** Same-tab subscribers. `storage` only fires in the tabs that did not write. */
const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);

  function onSystemChange() {
    // Only 'system' follows the OS. Somebody who chose light does not want to
    // be switched at sunset.
    if (readThemePref() === 'system') applyTheme(resolveTheme('system', media.matches));
    notify();
  }

  // Another tab wrote the preference. `storage` does not fire in the tab that
  // did the writing, so this is the only signal this one gets, and re-rendering
  // the control without repainting the document would leave the settings screen
  // claiming Light over a dark page.
  function onStorage() {
    applyTheme(resolveTheme(readThemePref(), media.matches));
    notify();
  }

  media.addEventListener('change', onSystemChange);
  window.addEventListener('storage', onStorage);
  listeners.add(notify);

  return () => {
    media.removeEventListener('change', onSystemChange);
    window.removeEventListener('storage', onStorage);
    listeners.delete(notify);
  };
}

function getSnapshot(): string {
  const pref = readThemePref();
  return `${pref}|${resolveTheme(pref, window.matchMedia(DARK_QUERY).matches)}`;
}

/** The server has no storage and no media query, and dark is what the document
 *  ships with, so this is what the first render agrees with. */
const getServerSnapshot = () => 'system|dark';

export function useTheme(): {
  pref: ThemePref;
  theme: Theme;
  setPref: (next: ThemePref) => void;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [pref, theme] = snapshot.split('|') as [ThemePref, Theme];

  const setPref = useCallback((next: ThemePref) => {
    writeThemePref(next);
    applyTheme(resolveTheme(next, window.matchMedia(DARK_QUERY).matches));
    for (const notify of listeners) notify();
  }, []);

  return { pref, theme, setPref };
}
