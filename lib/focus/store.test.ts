import { describe, expect, it } from 'vitest';
import { CLOCK_KEY, readClock, writeClock } from './store';
import type { FocusClock } from './timer';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const CLOCK: FocusClock = {
  sessionId: 's1',
  taskId: 't1',
  plannedMinutes: 25,
  accumulatedMs: 60_000,
  runningSince: 1_800_000_000_000,
};

describe('the stored clock', () => {
  it('round trips', () => {
    const store = fakeStorage();
    writeClock(CLOCK, store);
    expect(readClock(store)).toEqual(CLOCK);
  });

  it('clears on null rather than storing one', () => {
    const store = fakeStorage();
    writeClock(CLOCK, store);
    writeClock(null, store);
    expect(store.getItem(CLOCK_KEY)).toBeNull();
    expect(readClock(store)).toBeNull();
  });

  it('discards a shape it does not recognize', () => {
    expect(readClock(fakeStorage({ [CLOCK_KEY]: '{"sessionId":"s1"}' }))).toBeNull();
    expect(readClock(fakeStorage({ [CLOCK_KEY]: 'not json' }))).toBeNull();
    expect(readClock(fakeStorage({ [CLOCK_KEY]: 'null' }))).toBeNull();
  });

  it('keeps a paused clock, where runningSince is null on purpose', () => {
    const store = fakeStorage();
    const paused = { ...CLOCK, runningSince: null };
    writeClock(paused, store);
    expect(readClock(store)).toEqual(paused);
  });

  it('survives storage that throws, which is a locked-down profile', () => {
    const throwing = {
      ...fakeStorage(),
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;

    expect(readClock(throwing)).toBeNull();
    expect(() => writeClock(CLOCK, throwing)).not.toThrow();
  });

  it('answers null when there is no storage at all', () => {
    expect(readClock(null)).toBeNull();
    expect(() => writeClock(CLOCK, null)).not.toThrow();
  });
});
