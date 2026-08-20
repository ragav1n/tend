// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useScrollLock } from './use-scroll-lock';

/**
 * Two overlays can hold the lock at once, and one of those pairs happens on a
 * real path: tapping Search in the More sheet closes the sheet and opens the
 * palette, and the sheet stays mounted for its exit animation. Each unmount
 * restoring what it captured meant the sheet's cleanup unlocked the page with
 * the palette still open, so the page scrolled behind the modal.
 *
 * Tested here rather than in a browser because the refcount is the whole
 * behaviour, and a counter shared across components is exactly the kind of
 * thing that works until two of them overlap.
 */

function Overlay() {
  useScrollLock();
  return null;
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

const overflow = () => document.body.style.overflow;

describe('useScrollLock', () => {
  it('locks while one overlay holds it and restores after', () => {
    const first = render(<Overlay />);
    expect(overflow()).toBe('hidden');

    first.unmount();
    expect(overflow()).toBe('');
  });

  it('stays locked while a second overlay is still open', () => {
    const sheet = render(<Overlay />);
    const palette = render(<Overlay />);
    expect(overflow()).toBe('hidden');

    // The sheet leaves first, mid exit animation, with the palette up.
    sheet.unmount();
    expect(overflow()).toBe('hidden');

    palette.unmount();
    expect(overflow()).toBe('');
  });

  it('gives the page back the style it arrived with, not a blank one', () => {
    document.body.style.overflow = 'scroll';

    const held = render(<Overlay />);
    expect(overflow()).toBe('hidden');

    held.unmount();
    expect(overflow()).toBe('scroll');
  });

  it('survives being taken and released several times over', () => {
    for (let i = 0; i < 3; i++) {
      const held = render(<Overlay />);
      expect(overflow()).toBe('hidden');
      held.unmount();
      expect(overflow()).toBe('');
    }
  });
});
