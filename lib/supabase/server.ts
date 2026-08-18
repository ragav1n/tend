import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';

/**
 * The server Supabase client, holding the user's own session.
 *
 * Both sync RPCs are SECURITY INVOKER, so they run as the signed-in user and
 * RLS applies exactly as it would to a direct query. The service-role key is
 * never involved, which means a bug in a route handler cannot read another
 * user's rows: it would have to defeat Postgres to do it.
 *
 * `cookies()` is async in Next 16. The synchronous fallback is removed, not
 * deprecated.
 */
export async function getServerSupabase() {
  const store = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where the cookie store is read
          // only. Harmless: proxy.ts refreshes the session on every request, so
          // the write this is missing already happened there.
        }
      },
    },
  });
}
