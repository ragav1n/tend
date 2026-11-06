'use client';

import { useEffect } from 'react';
import { rollMissedRepeats } from '@/lib/db/mutations';

/**
 * Moves missed repeats onto today, on launch and whenever the app comes back.
 *
 * Coming back is the moment that matters: an installed PWA left open overnight
 * never remounts, and the first thing seen in the morning would be yesterday's
 * daily tasks in Overdue.
 */
export function useRollRepeats(): void {
  useEffect(() => {
    const roll = () => {
      if (document.visibilityState === 'visible') void rollMissedRepeats();
    };
    roll();
    document.addEventListener('visibilitychange', roll);
    return () => document.removeEventListener('visibilitychange', roll);
  }, []);
}
