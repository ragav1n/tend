import { describe, expect, it } from 'vitest';
import { isThemePref, resolveTheme, THEME_COLOR, THEME_SCRIPT } from './theme';

/**
 * The theme decision, which runs before anything else on a cold load.
 *
 * Worth a test out of proportion to its size: it is four lines that decide the
 * first painted frame, and getting it wrong is a flash of the other ramp on
 * every launch rather than an error anybody reports.
 */

describe('resolveTheme', () => {
  it('follows the OS only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('ignores the OS when a choice was made', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('isThemePref', () => {
  it('accepts the three real values', () => {
    for (const value of ['system', 'light', 'dark']) expect(isThemePref(value)).toBe(true);
  });

  it('rejects anything else, since this reads from localStorage', () => {
    for (const value of [null, undefined, '', 'DARK', 'auto', 0, {}]) {
      expect(isThemePref(value), String(value)).toBe(false);
    }
  });
});

/**
 * Enough of a document for the script to run in node.
 *
 * It creates the theme-color tag rather than finding one, so this records the
 * tag it appended and what it set on it.
 */
function fakeDocument() {
  // Attributes land in a plain record, so an assertion can compare it whole
  // without the element's own methods getting in the way.
  const created: Record<string, string>[] = [];
  return {
    documentElement: { dataset: {} as Record<string, string> },
    head: { appendChild: () => {} },
    querySelector: () => null,
    createElement: () => {
      const attrs: Record<string, string> = {};
      created.push(attrs);
      return {
        setAttribute(name: string, value: string) {
          attrs[name] = value;
        },
      };
    },
    created,
  };
}

describe('the inline script', () => {
  it('falls back to dark rather than throwing when storage is blocked', () => {
    // Private mode can make localStorage.getItem throw outright. The script runs
    // before anything else on the page, so an exception here is a blank app.
    const run = (storage: unknown, prefersDark: boolean) => {
      const doc = fakeDocument();
      new Function('document', 'localStorage', 'window', THEME_SCRIPT)(doc, storage, {
        matchMedia: () => ({ matches: prefersDark }),
      });
      return doc.documentElement.dataset.theme;
    };

    const throws = {
      getItem() {
        throw new Error('blocked');
      },
    };
    expect(run(throws, false)).toBe('dark');
  });

  it('resolves the same three answers the hook does', () => {
    const run = (stored: string | null, prefersDark: boolean) => {
      const doc = fakeDocument();
      new Function('document', 'localStorage', 'window', THEME_SCRIPT)(
        doc,
        { getItem: () => stored },
        { matchMedia: () => ({ matches: prefersDark }) },
      );
      return doc.documentElement.dataset.theme;
    };

    expect(run('light', true)).toBe('light');
    expect(run('dark', false)).toBe('dark');
    expect(run('system', true)).toBe('dark');
    expect(run('system', false)).toBe('light');
    // A missing or tampered value is 'system', not a crash.
    expect(run(null, true)).toBe('dark');
    expect(run('purple', false)).toBe('light');
  });

  it('creates the theme-color tag and fills it from the resolved ramp', () => {
    // React re-inserts any head tag it manages as soon as this changes one, so
    // the script owns the tag outright instead of editing a rendered copy.
    const run = (prefersDark: boolean) => {
      const doc = fakeDocument();
      new Function('document', 'localStorage', 'window', THEME_SCRIPT)(
        doc,
        { getItem: () => 'system' },
        { matchMedia: () => ({ matches: prefersDark }) },
      );
      return doc.created;
    };

    expect(run(true)).toEqual([{ name: 'theme-color', content: THEME_COLOR.dark }]);
    expect(run(false)).toEqual([{ name: 'theme-color', content: THEME_COLOR.light }]);
  });
});
