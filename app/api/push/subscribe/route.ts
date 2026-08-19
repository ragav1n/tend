import { NextResponse } from 'next/server';
import { newId } from '@/lib/db/ids';
import { getServerSupabase } from '@/lib/supabase/server';

/**
 * Registering and unregistering this browser for notifications.
 *
 * Runs under the person's own cookie session, never the service role, so RLS is
 * what stops one account writing a subscription for another. The policies on
 * `push_subscriptions` are plain comparisons on `user_id`, so this route holds no
 * authorization logic of its own and cannot get it wrong.
 *
 * The endpoint is the identity of a subscription, so a repeat POST upserts on it.
 * A browser hands back the same endpoint for the same registration, and inserting
 * a second row would send that device every notification twice.
 *
 * `user_agent` is stored so a device list can name the browser later. It is
 * truncated, because a header nobody validates is not a field to hand a database.
 */

/** Long enough to recognise a browser, short enough not to be a text dump. */
const USER_AGENT_MAX = 200;

interface SubscriptionBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

export async function POST(request: Request) {
  const supabase = await getServerSupabase();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  let body: SubscriptionBody;
  try {
    body = (await request.json()) as SubscriptionBody;
  } catch {
    return NextResponse.json({ error: 'body must be json' }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : null;
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : null;
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : null;

  // All three or nothing. A row missing either key cannot have a payload
  // encrypted for it, so it would sit in the table making the claim think this
  // account can be notified when it cannot.
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: 'endpoint, keys.p256dh and keys.auth are all required' },
      { status: 400 },
    );
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      id: newId(),
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get('user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
      last_seen_at: new Date().toISOString(),
      // A re-subscribe is a working browser saying so, so its strikes go.
      failures: 0,
    },
    { onConflict: 'endpoint' },
  );

  if (error) {
    // The endpoint is unique across the table, and RLS scopes the update half of
    // an upsert to your own rows. So a browser already registered to a different
    // account cannot be taken over, and the refusal arrives here as a policy
    // violation rather than a conflict. Worth naming, because the alternative is
    // a 500 on a toggle with no explanation.
    if (error.code === '42501') {
      return NextResponse.json(
        { error: 'this browser is registered to another account' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  return NextResponse.json({ subscribed: true });
}

export async function DELETE(request: Request) {
  const supabase = await getServerSupabase();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  let body: { endpoint?: unknown };
  try {
    body = (await request.json()) as { endpoint?: unknown };
  } catch {
    return NextResponse.json({ error: 'body must be json' }, { status: 400 });
  }

  if (typeof body.endpoint !== 'string') {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400 });
  }

  // No user_id predicate, deliberately. RLS scopes the delete to the session's own
  // rows, and adding the check here would imply it was doing the work.
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint);

  if (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  return NextResponse.json({ subscribed: false });
}
