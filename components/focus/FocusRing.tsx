'use client';

import { motion } from 'motion/react';

/**
 * The countdown, drawn.
 *
 * Bigger sibling of `Ring`, and its own component rather than a size prop on
 * that one: this carries the time inside it, animates on a linear ramp because
 * a spring on a clock reads as the clock hesitating, and turns clay while
 * paused. Olive is state, so a running session is olive.
 */

interface FocusRingProps {
  /** 0 to 1. */
  ratio: number;
  /** `mm:ss`, already formatted. */
  time: string;
  caption: string;
  paused?: boolean;
  size?: number;
}

export function FocusRing({ ratio, time, caption, paused = false, size = 240 }: FocusRingProps) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, ratio));

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${time} left`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line-bright)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={paused ? 'var(--color-clay-400)' : 'var(--color-olive-400)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - clamped) }}
          // A tween, not the house spring: a clock that overshoots and settles
          // looks like a clock unsure what time it is.
          transition={{ duration: 0.45, ease: 'linear' }}
        />
      </svg>

      <div className="absolute text-center">
        <p className="tnum text-[2.75rem] leading-none text-text-hi">{time}</p>
        <p className="label mt-2 !text-[0.5625rem]">{caption}</p>
      </div>
    </div>
  );
}
