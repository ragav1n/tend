'use client';

import { MotionConfig } from 'motion/react';
import { SOFT } from '@/lib/motion';

/**
 * Installs the house spring as the default transition, so a `motion` element
 * with no `transition` prop inherits SOFT instead of the library default.
 * Override only when an element needs a different character, and reach for a
 * token in lib/motion.ts before writing numbers inline.
 *
 * reducedMotion="user" makes prefers-reduced-motion a real path: transform and
 * layout animations are dropped while opacity still animates, so the UI stays
 * legible instead of snapping between states.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig transition={SOFT} reducedMotion="user">
      {children}
    </MotionConfig>
  );
}
