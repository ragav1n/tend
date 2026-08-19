'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSyncState } from '@/hooks/use-sync';

/**
 * Says so when the local database had to be rebuilt.
 *
 * The recovery ladder in `lib/db/recovery.ts` gets the app running again after a
 * database that will not open, and it does that by deleting it. Doing that
 * silently would be the worst version of this feature: somebody opens the app,
 * their tasks are gone, and nothing on screen accounts for it. So the rebuild is
 * carried on the sync state and announced once.
 *
 * The message depends on whether there is a server to recover from, because the
 * two situations are genuinely different and one of them needs an action. Signed
 * in, the next pull refills the store and there is nothing to do. Signed out, the
 * rescued queue is the only copy left, and signing in is what turns it back into
 * tasks.
 */
export function RecoveryNotice() {
  const { rebuilt, session } = useSyncState();
  const router = useRouter();
  const announced = useRef(false);

  useEffect(() => {
    if (!rebuilt || announced.current) return;
    announced.current = true;

    const queued =
      rebuilt.rescued === 1 ? '1 unsent change' : `${rebuilt.rescued} unsent changes`;

    toast('This device’s copy had to be rebuilt', {
      description: session
        ? `Something on this device made the local store unreadable. Your tasks are coming back from the server, and ${queued} survived.`
        : `Something on this device made the local store unreadable. ${queued} survived, and signing in is what turns them back into tasks.`,
      duration: Infinity,
      // No action when there is nothing to do. A button that only dismisses is a
      // button that teaches people to press buttons without reading.
      ...(session
        ? {}
        : { action: { label: 'Sign in', onClick: () => router.push('/signin') } }),
    });
  }, [rebuilt, session, router]);

  return null;
}
