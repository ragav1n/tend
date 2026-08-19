'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sheet } from '@/components/ui/Sheet';
import { MORE_ITEMS } from '@/components/shell/nav';
import { useSidebarCounts } from '@/hooks/use-tasks';
import { cn } from '@/lib/utils';

/**
 * The destinations the phone's bottom bar has no room for.
 *
 * A sheet rather than a second row of tabs: the bar is already at the width
 * where labels start truncating, and a nav that reflows as views are added is
 * how you end up with two of them.
 */
export function MoreMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const counts = useSidebarCounts();

  return (
    <Sheet open={open} onClose={onClose} label="More views">
      <div className="pt-1">
        <p className="label mb-2 px-1">Go to</p>
        <ul className="space-y-1">
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            const count = item.count ? counts[item.count] : 0;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-3',
                    active
                      ? 'border-line-bright bg-raised text-text-hi'
                      : 'border-line bg-surface text-text-mid',
                  )}
                >
                  <Icon
                    size={20}
                    weight={active ? 'fill' : 'regular'}
                    className={active ? 'text-clay-200' : 'text-text-lo'}
                    aria-hidden
                  />
                  <span className="flex-1 text-[0.9375rem]">{item.label}</span>
                  {count > 0 && <span className="tnum text-xs text-text-lo">{count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
