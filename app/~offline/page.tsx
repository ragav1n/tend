import type { Metadata } from 'next';
import { CloudSlash } from '@phosphor-icons/react/dist/ssr';
import { APP_NAME } from '@/lib/config';
import { cn } from '@/lib/utils';
import { MarkTile } from '@/components/brand/Mark';

/**
 * The offline fallback, precached with the rest of the shell.
 *
 * Almost nobody should see it. Every view is prerendered and precached, so the
 * normal offline path opens the real app and reads from IndexedDB. This page is
 * for a URL the cache has never held: a link into a route added since the last
 * visit, or a first load on a connection that died mid-handshake.
 *
 * So the copy answers the one question that matters, which is whether anything
 * was lost. Nothing was: the writes are in IndexedDB and the outbox drains when
 * the network comes back.
 *
 * A plain link rather than a reload button, because a link needs no JavaScript
 * and this page has to work when the bundle is exactly what failed to arrive.
 */

export const metadata: Metadata = {
  title: 'Offline',
};

export default function OfflinePage() {
  return (
    <main className={cn(
        'flex min-h-dvh items-center justify-center',
        'pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))]',
        'pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))]',
      )}>
      <div className="w-full max-w-sm text-center">
        <MarkTile size={40} className="mx-auto mb-5" />

        <div
          className="rounded-lg border border-line bg-surface px-6 py-8"
          style={{ boxShadow: 'var(--shadow-raised)' }}
        >
          <CloudSlash size={26} className="mx-auto mb-3 text-text-faint" aria-hidden />
          <h1 className="font-display text-2xl leading-none">No connection</h1>
          <p className="mx-auto mt-3 max-w-[32ch] text-sm leading-relaxed text-text-mid">
            This page has not been on this device before, so there is nothing to open
            yet.
          </p>
          <p className="mx-auto mt-2 max-w-[32ch] text-xs leading-relaxed text-text-lo">
            Your tasks are stored on the device. Anything you changed is queued and
            sends itself when you are back.
          </p>

          <a
            href="/today"
            className="mt-6 inline-flex items-center justify-center rounded-md border border-line bg-raised px-4 py-2 text-sm text-text-mid hover:border-clay-400 hover:text-text-hi"
          >
            Open {APP_NAME}
          </a>
        </div>
      </div>
    </main>
  );
}
