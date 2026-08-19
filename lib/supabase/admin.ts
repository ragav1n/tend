import { createClient } from '@supabase/supabase-js';
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
  return createClient(SUPABASE_URL, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Supabase renamed this key, and both names are accepted.
 *
 * `sb_secret_...` is the current one and it can be revoked on its own. The legacy
 * `service_role` key is a project-wide JWT, so revoking it means rotating the JWT
 * secret and every other key with it, which is why the new one is preferred where
 * both exist.
 *
 * Unlike the legacy key the new one is not a JWT, so `auth.uid()` is null under
 * it. Every function the cron calls already assumes that: the only one that reads
 * a uid is `recompute_task_notifications`, and its ownership check is skipped when
 * there is no session to check against.
 */
function secretKey(): string {
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!key) {
    throw new Error(
      'SUPABASE_SECRET_KEY is not set. Project Settings > API Keys > Secret keys, the ' +
        'sb_secret_ one. SUPABASE_SERVICE_ROLE_KEY is still read for a project on the ' +
        'legacy keys.',
    );
  }

  return key;
}
