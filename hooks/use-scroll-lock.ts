'use client';

import { useEffect } from 'react';

/**
 * Freeze the page behind an overlay.
 *
 * The padding compensation keeps a desktop scrollbar's width reserved, so the
 * page underneath does not jump sideways as the overlay appears.
 *
 * Refcounted, because two overlays can hold it at once and one of those pairs
 * happens on a real path: tapping Search in the More sheet closes the sheet and
 * opens the palette, and the sheet stays mounted for its exit animation. Each
 * unmount restoring what it captured meant the sheet's cleanup unlocked the
 * page with the palette still open, so the page scrolled behind the modal and
 * the scrollbar gutter collapsed under it.
 */
let holders = 0;
let restore: { overflow: string; paddingRight: string } | null = null;

export function useScrollLock(): void {
  useEffect(() => {
    const body = document.body;

    if (holders === 0) {
      restore = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      const gap = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = 'hidden';
      if (gap > 0) body.style.paddingRight = `${gap}px`;
    }
    holders += 1;

    return () => {
      holders -= 1;
      if (holders > 0 || !restore) return;
      body.style.overflow = restore.overflow;
      body.style.paddingRight = restore.paddingRight;
      restore = null;
    };
  }, []);
}
