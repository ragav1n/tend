'use client';

import { motion } from 'motion/react';
import { SOFT } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A small set of exclusive choices.
 *
 * The selected pill is one shared element moved with `layoutId`, so it slides
 * between options instead of two of them cross-fading. Each instance needs its
 * own `id`, or two segmented controls on the same screen trade pills.
 */

interface SegmentedProps<T extends string | number> {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({
  id,
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-0.5 rounded-md border border-line bg-sunken p-0.5"
      style={{ boxShadow: 'var(--shadow-sunken)' }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex-1 rounded-[7px] px-2 py-1 text-xs transition-colors duration-200',
              active ? 'text-text-hi' : 'text-text-lo hover:text-text-mid',
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${id}`}
                aria-hidden
                className="absolute inset-0 rounded-[7px] border border-line-bright bg-raised"
                transition={SOFT}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
