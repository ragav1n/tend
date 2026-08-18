'use client';

import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';

/**
 * The browser Supabase client, used for auth only.
 *
 * Sync deliberately does not go through it. The server has to stamp time and
 * version, an atomic multi-table push has to be one plpgsql function, and the
 * per-field merge needs field_versions which only the server holds. So this
 * client signs in, signs out and reports the session, and the two route
 * handlers do the data work.
 *
 * A module singleton rather than a hook, because the sync engine needs it from
 * outside the React tree.
 */
let instance: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabase() {
  instance ??= createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return instance;
}
