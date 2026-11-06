'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { rollMissedRepeats } from '@/lib/db/mutations';
import { missedRepeats, today } from '@/lib/db/queries';

/** Often enough to catch midnight within a minute, rare enough to cost nothing. */
const DAY_CHECK_MS = 60_000;

/**
 * Moves missed repeats onto the day they belong to, whenever there are any.
 *
 * Watching the store rather than a few events is what covers every way a
 * missed repeat turns up: the app opening, an installed PWA left open past
 * midnight, which never remounts and may never lose focus, and rows a sync pull
 * delivers from a device that never rolled them. Once rolled, the count is
 * zero and the effect has nothing to do, so it cannot loop.
 */
export function useRollRepeats(): void {
  const [day, setDay] = useState(today);

  useEffect(() => {
    const check = () => setDay(today());
    const timer = setInterval(check, DAY_CHECK_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  const missed = useLiveQuery(async () => (await missedRepeats(day)).length, [day]);

  useEffect(() => {
    if (missed) void rollMissedRepeats(day);
  }, [missed, day]);
}
