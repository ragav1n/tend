'use client';

import { motion } from 'motion/react';
import { SOFT } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * An on/off switch.
 *
 * A real `<button role="switch">` rather than a styled checkbox, because the
 * knob has to move and a checkbox's own box has to be hidden to do that, which
 * costs the focus ring and gains nothing.
 *
 * Olive when on, since olive is state in this app and clay is interaction. The
 * knob is `text-hi` rather than white so it sits in the same ramp as everything
 * else, and the track keeps its border in both positions so the control does not
 * change size when it flips.
 */
export function Toggle({
  id,
  checked,
  onChange,
  label,
  describedBy,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  describedBy?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border p-0.5',
        'transition-colors duration-200',
        'focus-visible:border-clay-400 focus-visible:outline-none',
        checked ? 'border-olive-400 bg-olive-600' : 'border-line bg-sunken',
      )}
      style={{ boxShadow: checked ? undefined : 'var(--shadow-sunken)' }}
    >
      <motion.span
        aria-hidden
        layout
        transition={SOFT}
        className={cn(
          'block h-4.5 w-4.5 rounded-full',
          checked ? 'ml-auto bg-text-hi' : 'bg-text-faint',
        )}
      />
    </button>
  );
}
