// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SORT, readListSort, sortStorageKey, writeListSort } from './list-sort';

describe('a list sort, remembered per route', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts on the list own order', () => {
    expect(readListSort('/inbox')).toBe(DEFAULT_SORT);
  });

  it('reads back what was written', () => {
    writeListSort('/inbox', 'due');
    expect(readListSort('/inbox')).toBe('due');
  });

  it('keeps two routes apart', () => {
    writeListSort('/inbox', 'due');
    writeListSort('/someday', 'title');
    expect(readListSort('/inbox')).toBe('due');
    expect(readListSort('/someday')).toBe('title');
  });

  it('clears the key when the choice is back to the default', () => {
    writeListSort('/inbox', 'due');
    writeListSort('/inbox', 'manual');
    // Cleared rather than stored, so an unused route leaves nothing behind.
    expect(window.localStorage.getItem(sortStorageKey('/inbox'))).toBeNull();
    expect(readListSort('/inbox')).toBe('manual');
  });

  it('refuses a value it does not recognise', () => {
    // A key written by a newer build, or by hand.
    window.localStorage.setItem(sortStorageKey('/inbox'), 'by-vibes');
    expect(readListSort('/inbox')).toBe(DEFAULT_SORT);
  });
});
