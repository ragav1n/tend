import { NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/email/authorize';
import { getAdminSupabase } from '@/lib/supabase/admin';

/**
 * One request a day, so Supabase does not pause the project.
 *
 * A free Supabase project pauses after seven days with no requests, and pg_cron
 * does not count: it runs inside the database and never arrives as a request. So a
 * week away from the app would quietly stop every reminder, and the only symptom
 * would be silence.
 *
 * This is exactly what Vercel's Hobby allowance of one cron a day is good for. The
 * heartbeat row doubles as proof it ran.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'not authorized' }, { status: 401 });
  }

  const supabase = getAdminSupabase();

  // Any real query counts as activity. This one also proves the cron tick is
  // still running, which is the thing worth knowing once a day.
  const { data, error } = await supabase
    .from('cron_heartbeats')
    .select('name, at')
    .order('at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.rpc('record_cron_heartbeat', {
    p_name: 'keepalive',
    p_detail: { seen: data?.length ?? 0 },
  });

  return NextResponse.json({ ok: true, heartbeats: data });
}
