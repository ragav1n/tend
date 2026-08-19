'use client';

import { useEffect } from 'react';

/**
 * Freeze the page behind an overlay.
 *
 * The padding compensation keeps a desktop scrollbar's width reserved, so the
 * page underneath does not jump sideways as the overlay appears. Shared by the
 * sheet and the command palette, since getting this half right is what makes an
 * overlay feel cheap.
 */
export function useScrollLock(): void {
  useEffect(() => {
    const body = document.body;
    const { overflow, paddingRight } = body.style;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.overflow = overflow;
      body.style.paddingRight = paddingRight;
    };
  }, []);
}
