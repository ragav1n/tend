'use client';

import { motion } from 'motion/react';
import { SOFT } from '@/lib/motion';

/**
 * Daily completion ring.
 *
 * `strokeDashoffset` is the one property outside transform and opacity that gets
 * animated in this app. It forces a repaint rather than a composite, which is
 * affordable here because the element is 44px and there is exactly one on screen.
 * Olive because the ring reports state, not interaction.
 */

interface RingProps {
  /** 0 to 1. */
  ratio: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

export function Ring({ ratio, size = 44, strokeWidth = 3.5, label }: RingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, ratio));

  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${Math.round(clamped * 100)} percent complete`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line-bright)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-olive-400)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - clamped) }}
          transition={SOFT}
        />
      </svg>
      <span className="tnum absolute text-[0.6875rem] text-text-mid">
        {Math.round(clamped * 100)}
      </span>
    </div>
  );
}
