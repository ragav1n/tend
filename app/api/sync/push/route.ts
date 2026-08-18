import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { MAX_BATCH_MUTATIONS, type PushMutation, type PushResponse } from '@/lib/sync/protocol';

/**
 * Applies a batch of client mutations in one transaction.
 *
 * The batch is passed through whole rather than looped over here. `sync_push`
 * is one plpgsql function precisely so a subtask and the project it belongs to
 * either both land or neither does; sending them as separate requests would
 * reintroduce the partial-failure window the function exists to close.
 *
 * Every mutation carries an idempotency key, so a retry after a dropped
 * response returns the original result instead of applying twice.
 */
export async function POST(request: Request) {
  const supabase = await getServerSupabase();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  let body: { mutations?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be json' }, { status: 400 });
  }

  const mutations = body.mutations;
  if (!Array.isArray(mutations)) {
    return NextResponse.json({ error: 'mutations must be an array' }, { status: 400 });
  }

  // Rejected here as well as in the RPC. A batch this big is a client bug, and
  // catching it before the round trip keeps the error legible.
  if (mutations.length > MAX_BATCH_MUTATIONS) {
    return NextResponse.json(
      { error: `at most ${MAX_BATCH_MUTATIONS} mutations per batch` },
      { status: 413 },
    );
  }

  const { data, error } = await supabase.rpc('sync_push', {
    p_mutations: mutations as PushMutation[],
  });

  if (error) {
    const status = error.code === '28000' ? 401 : error.code === '22023' ? 400 : 500;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  return NextResponse.json(data as PushResponse);
}
