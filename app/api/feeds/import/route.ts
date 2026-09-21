import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { buildPayload, fetchFeed, type MatchableCourse } from '@/lib/courses/import';

/**
 * Reading the subscribed calendars and writing what they carry.
 *
 * Runs under the person's own cookie, never the service role. RLS decides which
 * feeds and courses this session can see, and `import_feed` derives the account
 * from `auth.uid()` rather than taking it as an argument, so there is nothing
 * here to point at somebody else's rows. That is what keeps
 * `lib/supabase/admin.ts` out of this file, per the rule that only cron routes
 * may hold the service role.
 *
 * The fetch has to happen here rather than in the browser. A Canvas feed sends
 * no CORS headers, so a page cannot read it at all, and that is the single
 * reason this route exists instead of the client doing the whole job.
 *
 * The URL is credential-shaped: anybody holding it can read the whole calendar.
 * It is never logged and never returned, and a failure reports the status code
 * rather than the request.
 */

export const dynamic = 'force-dynamic';

interface FeedRow {
  id: string;
  url: string;
  label: string;
}

export async function POST() {
  const supabase = await getServerSupabase();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const { data: feeds, error: feedError } = await supabase
    .from('feeds')
    .select('id, url, label')
    .eq('enabled', true)
    .is('deleted_at', null);

  if (feedError) {
    return NextResponse.json({ error: 'could not read the feed list' }, { status: 500 });
  }
  if (!feeds || feeds.length === 0) {
    return NextResponse.json({ feeds: 0, inserted: 0, updated: 0, events: 0, unmatched: 0 });
  }

  const { data: courseRows } = await supabase
    .from('courses')
    .select('id, code, feed_label')
    .is('deleted_at', null);

  const courses: MatchableCourse[] = (courseRows ?? []).map((row) => ({
    id: row.id as string,
    code: (row.code as string) ?? '',
    feedLabel: (row.feed_label as string) ?? '',
  }));

  const total = { feeds: 0, inserted: 0, updated: 0, events: 0, unmatched: 0 };
  const failures: { label: string; reason: string }[] = [];

  for (const feed of feeds as FeedRow[]) {
    const outcome = await importOne(supabase, feed, courses);

    if ('reason' in outcome) {
      failures.push({ label: feed.label, reason: outcome.reason });
      continue;
    }

    total.feeds += 1;
    total.inserted += outcome.inserted;
    total.updated += outcome.updated;
    total.events += outcome.events;
    total.unmatched += outcome.unmatched;
  }

  return NextResponse.json({ ...total, failures });
}

async function importOne(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  feed: FeedRow,
  courses: readonly MatchableCourse[],
): Promise<
  { inserted: number; updated: number; events: number; unmatched: number } | { reason: string }
> {
  const stamp = new Date().toISOString();

  const fetched = await fetchFeed(feed.url);
  if ('reason' in fetched) {
    await note(supabase, feed.id, stamp, fetched.reason);
    return fetched;
  }

  const payload = buildPayload(fetched.ics, courses);

  const { data, error } = await supabase.rpc('import_feed', { p_items: payload.items });
  if (error) {
    const reason = 'the import could not be written';
    await note(supabase, feed.id, stamp, reason);
    return { reason };
  }

  const counts = (data ?? {}) as { inserted?: number; updated?: number; events?: number };

  await supabase
    .from('feeds')
    .update({
      last_fetched_at: stamp,
      last_error: null,
      last_count: payload.total,
      last_unmatched: payload.unmatched,
    })
    .eq('id', feed.id);

  return {
    inserted: counts.inserted ?? 0,
    updated: counts.updated ?? 0,
    events: counts.events ?? 0,
    unmatched: payload.unmatched,
  };
}

/** Records a failure on the feed row, so the settings screen can say what
 *  happened rather than leaving somebody to guess at a silent button. */
async function note(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  id: string,
  stamp: string,
  reason: string,
): Promise<void> {
  await supabase.from('feeds').update({ last_fetched_at: stamp, last_error: reason }).eq('id', id);
}
