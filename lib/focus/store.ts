import type { FocusClock } from './timer';

/**
 * Where the running clock lives between renders, and between page loads.
 *
 * Not React state and not Dexie. Not React state because the timer has to
 * survive a navigation to Today and back, and not Dexie because a write per
 * second is a write per second. localStorage is read once at startup and
 * written on the four events that change the clock.
 *
 * The session row in Dexie is the record; this is the stopwatch.
 */

export const CLOCK_KEY = 'tend.focus.clock';

/** Every access is guarded. Storage throws outright in a locked-down profile,
 *  and an unhandled rejection on boot is worse than losing a timer. */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isClock(value: unknown): value is FocusClock {
  if (typeof value !== 'object' || value === null) return false;
  const clock = value as Partial<FocusClock>;
  return (
    typeof clock.sessionId === 'string' &&
    typeof clock.taskId === 'string' &&
    typeof clock.plannedMinutes === 'number' &&
    typeof clock.accumulatedMs === 'number' &&
    (clock.runningSince === null || typeof clock.runningSince === 'number')
  );
}

export function readClock(store: Storage | null = storage()): FocusClock | null {
  if (!store) return null;
  try {
    const raw = store.getItem(CLOCK_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // A shape from an older version, or a half-written value, is discarded
    // rather than crashing the view that reads it.
    return isClock(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeClock(clock: FocusClock | null, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    if (clock === null) store.removeItem(CLOCK_KEY);
    else store.setItem(CLOCK_KEY, JSON.stringify(clock));
  } catch {
    // Full or disabled. The timer still runs for this page load.
  }
}

// ─── The subscription ─────────────────────────────────────────────────────────
// Read through useSyncExternalStore rather than state set from an effect, so
// the server render and the hydrating pass both see null and nothing flashes.

let current: FocusClock | null = null;
let loaded = false;
const listeners = new Set<() => void>();

export function getClock(): FocusClock | null {
  if (!loaded) {
    current = readClock();
    loaded = true;
  }
  return current;
}

/** The server has no storage, and a clock is per device anyway. */
export function getServerClock(): null {
  return null;
}

export function setClock(next: FocusClock | null): void {
  current = next;
  loaded = true;
  writeClock(next);
  for (const listener of listeners) listener();
}

export function subscribeClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only: forgets what this module cached. */
export function resetClockCache(): void {
  current = null;
  loaded = false;
}
