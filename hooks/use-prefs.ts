'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db/client';
import { updatePrefs } from '@/lib/db/mutations';
import { deviceTimezone, PREFS_ID, withPrefDefaults } from '@/lib/db/prefs';
import type { Prefs } from '@/lib/db/types';

/**
 * Settings, as React state.
 *
 * The defaults are the placeholder rather than undefined, so a settings page
 * renders real values on the first paint instead of a form full of blanks that
 * fill in a frame later.
 */
export function usePrefs(): Prefs {
  return withPrefDefaults(useLiveQuery(() => getDb().prefs.get(PREFS_ID), [], undefined));
}

/** The zone is read once and never changes under us, so there is nothing to
 *  subscribe to. The store is here for its server snapshot, not its updates. */
const NO_UPDATES = () => () => {};

/**
 * The device's zone, or null until the browser has it.
 *
 * `Intl` resolves to UTC on the server and to the real zone in the browser, so
 * rendering it directly is a hydration mismatch. Suppressing that mismatch is
 * the wrong trade and it was measured: React keeps the server's text, so the
 * hint reads "UTC" on a machine in New York and never corrects itself. React
 * recovers correctly when the warning is left alone, which is to say the noisy
 * version was the honest one.
 *
 * So the value is withheld until hydration is over, the same split
 * `useMediaQuery` makes for a query the server cannot answer either. The caller
 * renders without it for one paint.
 */
export function useDeviceTimezone(): string | null {
  return useSyncExternalStore(NO_UPDATES, deviceTimezone, () => null);
}

/**
 * Adopts the device's timezone, once.
 *
 * The server column defaults to UTC and every reminder instant is computed from
 * it, so leaving it at UTC would send a digest at 3am to somebody in Boston. The
 * condition is narrow on purpose: only when the stored value is still the default
 * and the device says otherwise. After that the value is the person's, and a
 * laptop taken on holiday must not quietly reschedule their mornings.
 */
export function useAdoptDeviceTimezone(): void {
  const prefs = usePrefs();

  useEffect(() => {
    const device = deviceTimezone();
    if (prefs.timezone !== 'UTC' || device === 'UTC') return;
    void updatePrefs({ timezone: device });
  }, [prefs.timezone]);
}
