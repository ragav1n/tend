/**
 * The clock, as pure data.
 *
 * Elapsed time is computed from instants rather than counted by an interval.
 * A phone suspends a backgrounded tab and a laptop lid closes; both stop the
 * timers and neither tells the page. A counter that adds a second per tick
 * finishes a 25 minute session in whatever wall-clock time the browser felt
 * like giving it, and the number it reports is the one people notice is wrong.
 *
 * So the timer here holds `runningSince` and an accumulated total, and the
 * render loop only asks what time it is.
 */

export interface FocusClock {
  /** The session row this clock belongs to. */
  sessionId: string;
  /** Which task is being worked on. Empty for none. */
  taskId: string;
  plannedMinutes: number;
  /** Milliseconds banked by earlier runs, paused time excluded. */
  accumulatedMs: number;
  /** When the current run started, or null while paused. */
  runningSince: number | null;
}

export const MINUTE_MS = 60_000;
/** Nothing is a 25 minute session after a day. A tab left running overnight
 *  would otherwise bank sixteen hours of "focus" the moment it woke. */
export const MAX_SESSION_MS = 24 * 60 * MINUTE_MS;

export function isRunning(clock: FocusClock): boolean {
  return clock.runningSince !== null;
}

/** Time actually focused, paused time excluded, capped at a day. */
export function elapsedMs(clock: FocusClock, now: number): number {
  const live = clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince);
  return Math.min(clock.accumulatedMs + live, MAX_SESSION_MS);
}

export function plannedMs(clock: FocusClock): number {
  return clock.plannedMinutes * MINUTE_MS;
}

/** Never negative: an overrun reads as zero left rather than as a countup. */
export function remainingMs(clock: FocusClock, now: number): number {
  return Math.max(0, plannedMs(clock) - elapsedMs(clock, now));
}

export function isFinished(clock: FocusClock, now: number): boolean {
  return elapsedMs(clock, now) >= plannedMs(clock);
}

/** 0 to 1, for the ring. */
export function progress(clock: FocusClock, now: number): number {
  const planned = plannedMs(clock);
  if (planned <= 0) return 1;
  return Math.min(1, elapsedMs(clock, now) / planned);
}

/**
 * What a write should record: never more than the session that was started.
 *
 * A tab suspended at minute 3 of 25 and woken six hours later reports six hours
 * elapsed, and every one of those hours would be banked as focus by the pause
 * that follows. Nobody focused for six hours, and a weekly total that says so is
 * worth less than no total. Overtime past the planned length is dropped for the
 * same reason: nothing was watching, so the only defensible number is the one
 * that was promised.
 */
export function recordedSeconds(clock: FocusClock, now: number): number {
  return Math.round(Math.min(elapsedMs(clock, now), plannedMs(clock)) / 1000);
}

/** Banks the current run. Pausing an already paused clock changes nothing. */
export function pause(clock: FocusClock, now: number): FocusClock {
  if (clock.runningSince === null) return clock;
  return { ...clock, accumulatedMs: elapsedMs(clock, now), runningSince: null };
}

export function resume(clock: FocusClock, now: number): FocusClock {
  if (clock.runningSince !== null) return clock;
  return { ...clock, runningSince: now };
}

/** `mm:ss`, and `h:mm:ss` past an hour. Padded so the digits never shift. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1h 25m" for a total, where seconds are noise. */
export function formatMinutes(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
