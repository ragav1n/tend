import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';

/**
 * Session refresh on every request that matters.
 *
 * In Next 16 this file is `proxy.ts` at the root with a named `proxy` export.
 * It is the renamed middleware, it runs on the Node runtime only, and setting a
 * `runtime` export throws.
 *
 * The only job here is calling `getClaims()`, which refreshes an expired access
 * token and writes the rotated cookies onto the response. Without it a tab left
 * open overnight wakes up with a dead token, every sync request 401s, and the
 * engine parks in reauth_required for a session that could have been renewed.
 *
 * Note what it deliberately does not do: it never redirects an unauthenticated
 * request away from the app. Every read comes from IndexedDB, so the app works
 * signed out and works offline, and gating navigation on a session would break
 * both. Sign-in is a state the UI shows, not a wall the router enforces.
 */
export async function proxy(request: NextRequest) {
  // The response has to be created first and then handed to the client, so the
  // refreshed cookies land on the object that is actually returned.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims rather than getUser: it verifies the JWT locally against the
  // project's JWKS and only calls the network when the token needs rotating,
  // so the common case costs no round trip.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  // Without a matcher this runs on every request including public assets and,
  // later, the service worker. Excluding static output keeps a token refresh
  // off the path of every CSS file.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
