'use client';

import { motion } from 'motion/react';
import { FADE } from '@/lib/motion';
import { Ring } from '@/components/ui/Ring';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * Page heading.
 *
 * The serif is doing the work here: an earthy palette with a geometric sans reads
 * muddy, and Instrument Serif at display size is what makes it read considered
 * instead. It appears once per view, never inside a list.
 */

interface ViewHeaderProps {
  title: string;
  /** Small uppercase mono line above the title. Usually the date. */
  eyebrow?: string;
  subtitle?: string;
  progress?: { done: number; total: number; ratio: number };
}

export function ViewHeader({ title, eyebrow, subtitle, progress }: ViewHeaderProps) {
  // Remounts the dates below once hydration ends. `suppressHydrationWarning`
  // leaves the server's text in the DOM and records the client's in the
  // fiber, so a re-render finds no diff and the wrong date stays. A changed
  // key is what actually writes it. See the hook.
  const hydrated = useHydrated();
  return (
    <motion.header
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={FADE}
      className="mb-6 flex items-start justify-between gap-4"
    >
      <div className="min-w-0">
        {eyebrow && (
          // The eyebrow is usually a formatted date, and the server formats it in
          // the server's locale and timezone while the browser uses the user's.
          // The client value is the correct one, so the mismatch is suppressed
          // rather than papered over with a mount flag, which would pop in.
          <p className="label mb-1.5" key={hydrated ? 'client' : 'server'} suppressHydrationWarning>
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-[2rem] leading-none">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-text-lo">{subtitle}</p>}
      </div>

      {progress && progress.total > 0 && (
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="text-right">
            <p className="tnum text-sm text-text-mid">
              {progress.done}/{progress.total}
            </p>
            <p className="label !text-[0.5625rem]">done</p>
          </div>
          <Ring
            ratio={progress.ratio}
            label={`${progress.done} of ${progress.total} tasks complete`}
          />
        </div>
      )}
    </motion.header>
  );
}
