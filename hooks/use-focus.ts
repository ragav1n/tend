'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { startFocusSession, updateFocusSession } from '@/lib/db/mutations';
import {
  getClock,
  getServerClock,
  setClock,
  subscribeClock,
} from '@/lib/focus/store';
import {
  elapsedMs,
  isFinished,
  pause as pauseClock,
  resume as resumeClock,
  type FocusClock,
} from '@/lib/focus/timer';

/**
 * The focus timer.
 *
 * Two pieces of state that look like one: the clock, which is a device thing
 * living in localStorage, and the session row, which is a synced record of what
 * the clock measured. The row is written when the timer starts, so a tab that
 * dies at minute 22 still leaves 22 minutes behind, and it is updated on every
 * pause so the gap is never longer than one interval.
 *
 * The elapsed number is derived from instants and never counted. A backgrounded
 * tab is throttled to whatever the browser feels like, so an interval that adds
 * a second per tick reports a length nobody recognizes.
 */

/** Twice a second, so the seconds digit turns on time rather than up to a
 *  second late. Cheap: it re-renders one number. */
const TICK_MS = 500;

export function useFocusClock(): FocusClock | null {
  return useSyncExternalStore(subscribeClock, getClock, getServerClock);
}

/** A ticking clock while `active`, frozen otherwise. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  // Half a second after a resume this is still the tick from before the pause,
  // which reads as the banked total because elapsedMs floors a negative
  // interval at zero. Refreshing it during render would be a call to Date.now()
  // in a render, which is exactly the impurity the lint rule forbids.
  return now;
}

export interface FocusTimer {
  clock: FocusClock | null;
  now: number;
  running: boolean;
  /** True when the planned length is up and the session is waiting to be closed. */
  done: boolean;
  start: (input: { taskId?: string; plannedMinutes: number }) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => void;
  /** Closes the session and clears the clock. */
  stop: () => Promise<void>;
}

export function useFocusTimer(): FocusTimer {
  const clock = useFocusClock();
  const running = clock?.runningSince != null;
  const now = useNow(running);
  const done = clock !== null && isFinished(clock, now);

  const start = useCallback(
    async (input: { taskId?: string; plannedMinutes: number }) => {
      const startedAt = Date.now();
      const sessionId = await startFocusSession({
        taskId: input.taskId,
        plannedMinutes: input.plannedMinutes,
        startedAt: new Date(startedAt).toISOString(),
      });
      setClock({
        sessionId,
        taskId: input.taskId ?? '',
        plannedMinutes: input.plannedMinutes,
        accumulatedMs: 0,
        runningSince: startedAt,
      });
    },
    [],
  );

  const pause = useCallback(async () => {
    const live = getClock();
    if (!live || live.runningSince === null) return;
    const held = pauseClock(live, Date.now());
    setClock(held);
    // Banked on every pause rather than only at the end, so a tab that dies
    // while paused loses nothing.
    await updateFocusSession(held.sessionId, {
      focusedSeconds: Math.round(held.accumulatedMs / 1000),
    });
  }, []);

  const resume = useCallback(() => {
    const live = getClock();
    if (!live || live.runningSince !== null) return;
    setClock(resumeClock(live, Date.now()));
  }, []);

  const stop = useCallback(async () => {
    const live = getClock();
    if (!live) return;
    const at = Date.now();
    setClock(null);
    await updateFocusSession(live.sessionId, {
      focusedSeconds: Math.round(elapsedMs(live, at) / 1000),
      endedAt: new Date(at).toISOString(),
    });
  }, []);

  return { clock, now, running, done, start, pause, resume, stop };
}
