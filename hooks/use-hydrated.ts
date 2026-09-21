'use client';

import { useSyncExternalStore } from 'react';

/**
 * False during the server render and the hydration pass, true after it.
 *
 * For the components that format a date. The server formats in the server's
 * zone and locale and the browser formats in yours, so the two disagree, and
 * the repo's answer was `suppressHydrationWarning`. That silences the warning
 * and keeps the **server's** text: measured by building with
 * `TZ=Pacific/Kiritimati` and loading `/today` from a New York browser, the
 * eyebrow read `TUESDAY, 22 SEPTEMBER` against a device on `MONDAY, SEPTEMBER
 * 21`, and it stayed there. The suppression was right about the first paint and
 * wrong about every paint after it.
 *
 * Calling this in a component that formats a date buys one re-render the
 * instant hydration ends, which is what replaces the server's string with
 * yours. The alternative, withholding the date until mounted, was rejected
 * where it would move the layout: an eyebrow that appears a frame late pushes
 * the heading under it. `useDeviceTimezone` in `use-prefs.ts` takes that other
 * route, because a settings hint has no layout riding on it.
 *
 * The value is usually discarded. It is the re-render that is being asked for.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
