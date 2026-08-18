import { completeAuth } from '@/lib/supabase/complete-auth';

/**
 * Where a magic link lands when the email template was customized to send
 * `{{ .TokenHash }}`. Identical handling to the callback, because a link
 * arriving at the "wrong" one of these two should still sign you in.
 */
export async function GET(request: Request) {
  return completeAuth(request);
}
