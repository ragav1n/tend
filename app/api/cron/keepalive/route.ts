import { NextResponse } from 'next/server';
import { isCronRequest } from '@/lib/email/authorize';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { buildPayload, fetchFeed, type MatchableCourse } from '@/lib/courses/import';

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
 *
 * It also reads every subscribed course feed, which is the reason the ingest is
 * SQL rather than a client mutation. A deadline that only appears when you
 * happen to open the app is a deadline the reminder pipeline never got to email
 * you about, and the pipeline runs every minute regardless of whether anybody is
 * looking. One request a day is the whole budget, so the feeds ride along here
 * rather than asking for a second cron.
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

  const feeds = await readEveryFeed(supabase);

  await supabase.rpc('record_cron_heartbeat', {
    p_name: 'keepalive',
    p_detail: { seen: data?.length ?? 0, feeds },
  });

  return NextResponse.json({ ok: true, heartbeats: data, feeds });
}

/** Feeds read per run. A ceiling so one account with a hundred subscriptions
 *  cannot spend the whole invocation, and the rest go tomorrow. */
const MAX_FEEDS_PER_RUN = 50;

interface FeedRow {
  id: string;
  user_id: string;
  url: string;
}

/**
 * Reads every enabled feed, for every account.
 *
 * Service role, which is what this route is allowed to hold and the import
 * route deliberately is not. The scoping is explicit instead of RLS: each item
 * is written through `ingest_task(p_user, ...)` with the `user_id` that owned
 * the feed row, so a feed can only ever write into the account it belongs to.
 *
 * Failures are recorded on the feed row and never thrown. One unreachable campus
 * server must not stop the other accounts, and it must not stop the heartbeat,
 * which is the thing that keeps the project awake.
 */
async function readEveryFeed(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<{ read: number; inserted: number; failed: number }> {
  const summary = { read: 0, inserted: 0, failed: 0 };

  const { data: feeds } = await supabase
    .from('feeds')
    .select('id, user_id, url')
    .eq('enabled', true)
    .is('deleted_at', null)
    .limit(MAX_FEEDS_PER_RUN);

  if (!feeds || feeds.length === 0) return summary;

  // One course read per account rather than per feed, since somebody with two
  // subscriptions has one set of courses.
  const courses = new Map<string, MatchableCourse[]>();

  for (const feed of feeds as FeedRow[]) {
    const stamp = new Date().toISOString();

    const fetched = await fetchFeed(feed.url);
    if ('reason' in fetched) {
      summary.failed += 1;
      await supabase
        .from('feeds')
        .update({ last_fetched_at: stamp, last_error: fetched.reason })
        .eq('id', feed.id);
      continue;
    }

    if (!courses.has(feed.user_id)) {
      const { data: rows } = await supabase
        .from('courses')
        .select('id, code, feed_label')
        .eq('user_id', feed.user_id)
        .is('deleted_at', null);

      courses.set(
        feed.user_id,
        (rows ?? []).map((row) => ({
          id: row.id as string,
          code: (row.code as string) ?? '',
          feedLabel: (row.feed_label as string) ?? '',
        })),
      );
    }

    const payload = buildPayload(fetched.ics, courses.get(feed.user_id) ?? []);

    let inserted = 0;
    for (const item of payload.items) {
      const fn = item.kind === 'event' ? 'ingest_course_event' : 'ingest_task';
      const { data: outcome } = await supabase.rpc(fn, {
        p_user: feed.user_id,
        p_item: item,
      });
      if (outcome === 'inserted') inserted += 1;
    }

    summary.read += 1;
    summary.inserted += inserted;

    await supabase
      .from('feeds')
      .update({
        last_fetched_at: stamp,
        last_error: null,
        last_count: payload.total,
        last_unmatched: payload.unmatched,
      })
      .eq('id', feed.id);
  }

  return summary;
}
