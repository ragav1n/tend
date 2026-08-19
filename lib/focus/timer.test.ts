import { describe, expect, it } from 'vitest';
import {
  MAX_SESSION_MS,
  MINUTE_MS,
  elapsedMs,
  formatDuration,
  formatMinutes,
  isFinished,
  isRunning,
  pause,
  progress,
  remainingMs,
  resume,
  type FocusClock,
} from './timer';

const START = 1_800_000_000_000;

function clock(over: Partial<FocusClock> = {}): FocusClock {
  return {
    sessionId: 's1',
    taskId: '',
    plannedMinutes: 25,
    accumulatedMs: 0,
    runningSince: START,
    ...over,
  };
}

describe('elapsed', () => {
  it('measures from the instant it started, not from tick counting', () => {
    expect(elapsedMs(clock(), START + 5 * MINUTE_MS)).toBe(5 * MINUTE_MS);
  });

  it('stands still while paused', () => {
    const held = pause(clock(), START + 5 * MINUTE_MS);
    expect(isRunning(held)).toBe(false);
    expect(elapsedMs(held, START + 60 * MINUTE_MS)).toBe(5 * MINUTE_MS);
  });

  it('picks up where it left off on resume', () => {
    const held = pause(clock(), START + 5 * MINUTE_MS);
    const back = resume(held, START + 30 * MINUTE_MS);
    expect(elapsedMs(back, START + 32 * MINUTE_MS)).toBe(7 * MINUTE_MS);
  });

  it('ignores a second pause and a second resume', () => {
    const held = pause(clock(), START + 5 * MINUTE_MS);
    expect(pause(held, START + 9 * MINUTE_MS)).toEqual(held);
    const back = resume(held, START + 10 * MINUTE_MS);
    expect(resume(back, START + 11 * MINUTE_MS)).toEqual(back);
  });

  it('survives a clock that went backwards', () => {
    // An NTP correction mid-session, which reads as a negative interval.
    expect(elapsedMs(clock(), START - 60_000)).toBe(0);
  });

  it('caps a session left running overnight', () => {
    expect(elapsedMs(clock(), START + 40 * 60 * MINUTE_MS)).toBe(MAX_SESSION_MS);
  });
});

describe('the countdown', () => {
  it('never counts past zero', () => {
    const over = clock({ plannedMinutes: 25 });
    expect(remainingMs(over, START + 30 * MINUTE_MS)).toBe(0);
    expect(isFinished(over, START + 30 * MINUTE_MS)).toBe(true);
  });

  it('reports the fraction the ring draws', () => {
    expect(progress(clock(), START)).toBe(0);
    expect(progress(clock(), START + 5 * MINUTE_MS)).toBeCloseTo(0.2);
    expect(progress(clock(), START + 99 * MINUTE_MS)).toBe(1);
  });

  it('is finished the moment the planned length is reached, not after', () => {
    expect(isFinished(clock(), START + 25 * MINUTE_MS - 1)).toBe(false);
    expect(isFinished(clock(), START + 25 * MINUTE_MS)).toBe(true);
  });
});

describe('formatting', () => {
  it('pads so the digits do not shift as they count', () => {
    expect(formatDuration(25 * MINUTE_MS)).toBe('25:00');
    expect(formatDuration(9 * 1000)).toBe('00:09');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(-5000)).toBe('00:00');
  });

  it('adds an hour field only when there is one', () => {
    expect(formatDuration(59 * MINUTE_MS)).toBe('59:00');
    expect(formatDuration(61 * MINUTE_MS + 5000)).toBe('1:01:05');
  });

  it('reads a total in minutes and hours', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(90)).toBe('2m');
    expect(formatMinutes(25 * 60)).toBe('25m');
    expect(formatMinutes(60 * 60)).toBe('1h');
    expect(formatMinutes(85 * 60)).toBe('1h 25m');
  });
});
