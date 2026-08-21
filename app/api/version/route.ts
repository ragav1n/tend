import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/version';

/**
 * What version is deployed right now.
 *
 * A tab that has been open for a week is running the JS it was served with, and
 * the only authority on what is current is the deployment answering this. The
 * service worker finds out too, eventually, but only after a navigation or its
 * hourly check, and it can say "a new worker is waiting" without ever being
 * able to say which version that is.
 *
 * No session, no database, nothing about the person. The version is already in
 * every JS bundle this deployment serves.
 *
 * `/api` is `private` in `lib/pwa/cache-policy.ts`, so the service worker takes
 * this straight to the network and can never answer it from a cache, which for
 * this route is the whole point. `no-store` says the same thing to the browser
 * and to Vercel's edge.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { version: APP_VERSION },
    { headers: { 'cache-control': 'no-store, max-age=0' } },
  );
}
