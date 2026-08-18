'use client';

import type { Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * One labelled control in the detail panel.
 *
 * Controls sit in sunken wells rather than on raised cards. That is a contrast
 * decision as much as a visual one: on `raised` every accent has to step up to
 * its 200 and body text to `text-mid`, so a panel built from raised cards ends
 * up either lighter than it should be or quietly failing AA. Sunken keeps
 * `text-lo` legal, and the recessed look is what an input should read as anyway.
 */

export const controlClass = cn(
  'w-full rounded-md border border-line bg-sunken px-2.5 py-1.5',
  'text-sm text-text-hi placeholder:text-text-lo',
  'focus:border-clay-400 focus:outline-none',
);

export function Field({
  label,
  icon: IconComponent,
  htmlFor,
  children,
  className,
}: {
  label: string;
  icon?: Icon;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 py-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="flex w-[6.5rem] shrink-0 items-center gap-1.5 text-xs text-text-lo"
      >
        {IconComponent && <IconComponent size={14} aria-hidden />}
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Section break inside the panel. Quieter than a heading, louder than nothing. */
export function FieldGroup({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="label !text-[0.625rem]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
