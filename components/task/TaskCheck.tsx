'use client';

import { motion, useReducedMotion } from 'motion/react';
import { CHECK_DRAW, CHECK_PRESS, CHECK_RELEASE } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The check-off.
 *
 * This is the most-touched control in the app, so it gets a hand-built
 * interaction rather than a styled `<input type="checkbox">`. The sequence:
 *
 *   press    the box sinks 1px and shrinks             90ms tween
 *   release  springs back to rest                      spring 320/22
 *   draw     the mark strokes on via pathLength        500ms
 *
 * The mark is a scribble ported from a uiverse.io checkbox, kept for its motion
 * and re-skinned to the tokens. Three things changed on the way in. The original
 * ships as styled-components with a CSS `stroke-dashoffset` transition, which is
 * rewritten here as `pathLength` on a `motion.path` so it runs on the same
 * timing system as everything else. The original's own `<rect>` is dropped,
 * because the box is part of the tactile-material system and already exists. And
 * the viewBox is reframed to the path's real ink bounds (12.2..78.3 by
 * 10.6..76.4 of a 95 unit square) rather than to that rect, so the mark centres
 * on the box with an even overshoot instead of hanging 8px off the left edge.
 *
 * Olive is the state accent, so completion is olive and never clay. Clay means
 * "you can act here", which is why it appears on the hover border and the focus
 * ring but not on the completed state. There is no fill behind the mark: a pen
 * stroke on paper does not come with a filled box, and a wash under a scribble
 * reads as mud.
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
  /** Shared-element id, so the control flies from a row into the detail panel. */
  layoutId?: string;
  /** Edge length in px. 22 is the row's; a subtask uses 18, which reads as a
   *  child of the thing above it without needing a second indent. */
  size?: number;
  className?: string;
}

/** The uiverse path, with its `translate(0,-952.36222)` folded into the start
 *  point so the group wrapper is not needed. */
const SCRIBBLE =
  'M 56,10.638 c -102,122 6,9 7,9 17,-5 -66,69 -38,52 122,-77 -7,14 18,4 29,-11 45,-43 23,-4';

/** Framed to the ink rather than the source's box, plus two units of margin. */
const SCRIBBLE_VIEWBOX = '10 8 70 70';

export function TaskCheck({
  checked,
  onChange,
  label,
  layoutId,
  size = 22,
  className,
}: TaskCheckProps) {
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
      layoutId={layoutId}
      className={cn(
        'relative shrink-0 rounded-[7px] border-[1.5px]',
        checked ? 'border-olive-400' : 'border-line-strong bg-sunken hover:border-clay-400',
        className,
      )}
      style={{
        width: size,
        height: size,
        boxShadow: checked ? 'none' : 'var(--shadow-sunken)',
      }}
      // Depth rather than scale alone: the control moves in Z the way a physical
      // button would. The press is a fast tween and the return is a spring, so
      // it lands softly instead of clicking back.
      whileTap={reduced ? undefined : { y: 1, scale: 0.9, transition: CHECK_PRESS }}
      transition={CHECK_RELEASE}
    >
      {/* Deliberately larger than the box and unclipped. The overshoot past the
          corners is the whole reason this mark reads as drawn rather than set. */}
      <svg
        viewBox={SCRIBBLE_VIEWBOX}
        className="pointer-events-none absolute -inset-[3px] overflow-visible"
        aria-hidden
      >
        <motion.path
          d={SCRIBBLE}
          fill="none"
          stroke="var(--color-olive-200)"
          strokeWidth={5}
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
