import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { DEFAULT_PULL_LIMIT, type PullResponse } from '@/lib/sync/protocol';

/**
 * Everything that changed above the client's cursor.
 *
 * A thin wrapper on `sync_pull`, and thin on purpose. Every decision that
 * matters (what a page is, how the cursor advances, which columns a client is
 * allowed to see) lives in the RPC, where it runs inside the transaction that
 * reads the rows. Duplicating any of it here would give two places to disagree.
 *
 * Route handlers are uncached by default in Next 16, which is what this needs:
 * a cached pull would serve one user's page to the next request.
 */
export async function POST(request: Request) {
  const supabase = await getServerSupabase();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  let body: { cursor?: unknown; limit?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be json' }, { status: 400 });
  }

  const cursor = Number(body.cursor ?? 0);
  const limit = Number(body.limit ?? DEFAULT_PULL_LIMIT);

  if (!Number.isFinite(cursor) || cursor < 0) {
    return NextResponse.json({ error: 'cursor must be a non-negative number' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('sync_pull', {
    p_cursor: cursor,
    p_limit: Number.isFinite(limit) ? limit : DEFAULT_PULL_LIMIT,
  });

  if (error) {
    // 28000 is the RPC's own not-authenticated guard. It maps to 401 so the
    // client classifies it as a reauth rather than backing off against a
    // session that is never coming back on its own.
    const status = error.code === '28000' ? 401 : 500;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  return NextResponse.json(data as PullResponse);
}
