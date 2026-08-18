import { createClient } from '@supabase/supabase-js';
import { requireEnv } from '@/lib/email/env';
import { SUPABASE_URL } from './env';

/**
 * The service-role client, which bypasses RLS entirely.
 *
 * Used by exactly one thing: the reminder cron, which has to read across every
 * user's deliveries and has no session to run under. Everything a signed-in
 * person does goes through `getServerSupabase` and their own cookie, so a bug in
 * an ordinary route cannot read somebody else's rows.
 *
 * Never import this into a client component. The key is server only, and Next
 * will not stop you: it has no NEXT_PUBLIC_ prefix, so it simply arrives as
 * undefined in the browser and the call fails at runtime instead of at build.
 */
export function getAdminSupabase() {
  return createClient(SUPABASE_URL, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
