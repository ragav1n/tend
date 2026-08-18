'use client';

import { motion, useReducedMotion } from 'motion/react';
import { CHECK_DRAW, CHECK_FILL, CHECK_PRESS, CHECK_RELEASE } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The check-off.
 *
 * This is the most-touched control in the app, so it gets a hand-built
 * interaction rather than a styled `<input type="checkbox">`. The sequence:
 *
 *   press    the box sinks 1px and shrinks             90ms tween
 *   release  springs back to rest                      spring 320/22
 *   fill     olive crossfades in behind the tick       180ms
 *   draw     the tick strokes on via pathLength        220ms
 *
 * Olive is the state accent, so completion is olive and never clay. Clay means
 * "you can act here", which is why it appears on the hover border and the focus
 * ring but not on the completed state.
 *
 * The draw survives prefers-reduced-motion on purpose: it carries meaning rather
 * than decoration. What gets dropped is the press displacement and the spring,
 * which are the parts that actually bother people.
 */

interface TaskCheckProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Announced to screen readers, so it needs the task title. */
  label: string;
  className?: string;
}

/** Slight overshoot past the corner reads as a confident stroke, not a glyph. */
const TICK_PATH = 'M5 11.5 L9.2 15.5 L16.5 6.8';

export function TaskCheck({ checked, onChange, label, className }: TaskCheckProps) {
  const reduced = useReducedMotion();

  function handleClick() {
    onChange(!checked);
    // Android and most desktop browsers have this; iOS Safari does not, so it is
    // a bonus rather than part of the interaction.
    if (!checked && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(12);
    }
  }

  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={handleClick}
      className={cn(
        'relative grid size-[22px] shrink-0 place-items-center overflow-hidden',
        'rounded-[7px] border-[1.5px]',
        checked ? 'border-olive-400' : 'border-line-strong bg-sunken hover:border-clay-400',
        className,
      )}
      style={{ boxShadow: checked ? 'none' : 'var(--shadow-sunken)' }}
      // Depth rather than scale alone: the control moves in Z the way a physical
      // button would. The press is a fast tween and the return is a spring, so
      // it lands softly instead of clicking back.
      whileTap={reduced ? undefined : { y: 1, scale: 0.9, transition: CHECK_PRESS }}
      transition={CHECK_RELEASE}
    >
      <motion.span
        aria-hidden
        className="absolute inset-0 bg-olive-600"
        initial={false}
        animate={{ opacity: checked ? 1 : 0 }}
        transition={CHECK_FILL}
      />
      <svg viewBox="0 0 22 22" className="relative size-[22px]" aria-hidden>
        <motion.path
          d={TICK_PATH}
          fill="none"
          stroke="var(--color-text-hi)"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          // Drawing on is the moment worth watching. Undoing is not, so it just
          // disappears rather than un-drawing in reverse.
          transition={checked ? CHECK_DRAW : { duration: 0.12 }}
        />
      </svg>
    </motion.button>
  );
}
