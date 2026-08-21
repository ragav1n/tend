'use client';

import { motion } from 'motion/react';
import { STRIKE, STRIKE_OFF } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A title and the line that crosses it out.
 *
 * The line is sized to the words. It used to be a `w-full` span inside the row's
 * flex container, which drew the full width of the card: "Book the dentist" on a
 * 576px row came with 400px of olive rule trailing off into empty space.
 *
 * Shared by the row, the subtask under it and the subtask in the detail panel,
 * so ticking a child animates the same way as ticking its parent. It sweeps from
 * the left rather than fading in, which reads as a pen stroke through the words,
 * and it animates scaleX alone so it stays on the compositor.
 */
export function StruckTitle({
  title,
  done,
  className,
}: {
  title: string;
  done: boolean;
  className?: string;
}) {
  return (
    // inline-block so the box is the text, capped at the space it has. `truncate`
    // then clips the line to the same width as the ellipsis.
    <span className={cn('relative inline-block max-w-full truncate', className)}>
      {title}
      <motion.span
        aria-hidden
        className="absolute left-0 top-1/2 h-[1.5px] w-full origin-left rounded-full bg-olive-300"
        initial={false}
        animate={{ scaleX: done ? 1 : 0, opacity: done ? 1 : 0 }}
        transition={done ? STRIKE : STRIKE_OFF}
      />
    </span>
  );
}
