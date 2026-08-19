/**
 * Which cache rule a request falls under.
 *
 * This lives outside `app/sw.ts` so it can be tested. The worker is bundled by
 * esbuild with no type checking and runs in a scope Vitest cannot reproduce, so
 * a decision left inline there is a decision nothing verifies. The rule that
 * matters most is negative, and a negative rule is exactly the kind that rots
 * quietly: nobody notices a cache that holds too much until somebody reads
 * another account's tasks out of it.
 *
 * One function returning one answer, rather than an ordered list of matchers
 * where a later entry can shadow an earlier one. `private` is checked first and
 * wins over everything, including navigation, so no combination of properties
 * can talk a session-bearing response into a cache.
 */

export type CacheRule =
  /** Never cached, ever. Carries a session or could expose one. */
  | 'private'
  /** Content-hashed by the build, so the bytes at a URL never change. */
  | 'immutable'
  /** The payload a client-side navigation fetches. */
  | 'rsc'
  /** A full page load. */
  | 'navigation'
  /** Not ours to cache. Straight to the network. */
  | 'passthrough';

export interface RequestFacts {
  url: URL;
  sameOrigin: boolean;
  /** The request carries Next's `RSC: 1` header. */
  isRsc: boolean;
  /** `request.mode === 'navigate'`. */
  isNavigation: boolean;
}

/**
 * `/api` covers sync and the cron routes, `/auth` covers the OAuth and magic
 * link callbacks, whose URLs carry a single-use code.
 */
const PRIVATE_PREFIXES = ['/api/', '/auth/'];

/** Postgres, auth and storage all answer on the project subdomain. */
const SUPABASE_HOST = '.supabase.co';

export function classify({ url, sameOrigin, isRsc, isNavigation }: RequestFacts): CacheRule {
  if (!sameOrigin) {
    // Supabase is the only cross-origin request the app makes, and every one of
    // them carries the access token. Anything else cross-origin is somebody
    // else's to cache.
    return url.hostname.endsWith(SUPABASE_HOST) ? 'private' : 'passthrough';
  }

  if (PRIVATE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return 'private';

  if (url.pathname.startsWith('/_next/static/')) return 'immutable';

  // Checked before navigation because Next sends the header on a prefetch of a
  // document too, and the RSC payload belongs in its own cache: it is keyed by
  // the same URL as the HTML and would otherwise overwrite it.
  if (isRsc) return 'rsc';

  if (isNavigation) return 'navigation';

  return 'passthrough';
}
