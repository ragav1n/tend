'use client';

import { useEffect } from 'react';
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
