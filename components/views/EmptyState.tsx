'use client';

import type { Icon } from '@phosphor-icons/react';

/**
 * Empty states.
 *
 * Placeholder art until the sourced illustrations land. Deliberately quiet: an
 * empty Today list is a good outcome, so it should read as calm rather than as an
 * error or a nag.
 */
export function EmptyState({
  icon: IconComponent,
  title,
  hint,
}: {
  icon: Icon;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-line/60 px-6 py-14 text-center">
      <IconComponent size={26} className="text-text-faint" aria-hidden />
      <p className="text-sm text-text-mid">{title}</p>
      {hint && <p className="max-w-[26ch] text-xs text-text-lo">{hint}</p>}
    </div>
  );
}
