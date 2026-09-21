'use client';

import { useEffect, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Who is signed in on this device.
 *
 * `getSession` reads the stored token rather than calling the network, so this
 * still answers on a plane, which is the same reason the sync engine reaches for
 * it instead of `getUser`.
 *
 * A second `onAuthStateChange` listener alongside the engine's is deliberate.
 * Supabase fans the event out to every subscriber, and routing this through the
 * engine's state would mean widening `SyncState` with a field only one row of
 * Settings reads.
 */
export function useAccountEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    let alive = true;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (alive) setEmail(data.session?.user.email ?? null);
    })();

    const { data } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (alive) setEmail(session?.user.email ?? null);
      },
    );

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return email;
}

/**
 * Drops the session on this device and nothing else.
 *
 * `scope: 'local'` rather than the default. A global sign-out revokes the
 * refresh token for every device on the account, so signing out of a laptop
 * would quietly sign the phone out too, and somebody clearing a shared machine
 * is not asking for that.
 *
 * The local database stays. One person's tasks are the same tasks whether or not
 * a session is attached, the app has always worked signed out, and the outbox
 * still holds work the server has not seen: throwing it away here would lose
 * edits made offline to get a sign-out button. The sync engine hears
 * `SIGNED_OUT` through its own listener and parks itself.
 */
export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut({ scope: 'local' });
  if (error) throw error;
}
