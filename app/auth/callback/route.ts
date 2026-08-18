import { completeAuth } from '@/lib/supabase/complete-auth';

/** Where OAuth providers and default-template magic links land. */
export async function GET(request: Request) {
  return completeAuth(request);
}
