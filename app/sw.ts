import {
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  type PrecacheEntry,
  type RouteMatchCallback,
  type RuntimeCaching,
  type SerwistGlobalConfig,
} from 'serwist';
import { classify, type CacheRule } from '@/lib/pwa/cache-policy';

/**
 * The service worker.
 *
 * Two rules run the whole file:
 *
 * 1. **No authenticated response ever enters the cache.** Everything under
 *    `/api`, `/auth` and every Supabase request is `NetworkOnly`. A cached sync
 *    response would be one account's rows sitting in a shared cache, readable
 *    after sign out, and no expiry policy makes that acceptable. Which rule a
 *    request falls under is decided in `lib/pwa/cache-policy.ts`, because that
 *    file can be tested and this one cannot.
 * 2. **IndexedDB is the offline read source, not this file.** The cache holds the
 *    shell: hashed assets, the prerendered HTML of each view, and the offline
 *    fallback. Every task, project and tag comes from Dexie. So the cache going
 *    stale costs a reload, never a row.
 *
 * Caching navigations is safe only because the whole authenticated group is
 * client rendered and its HTML contains no user data. If a view ever renders a
 * task on the server, the navigation entries below have to go.
 *
 * `skipWaiting` stays off. An automatic swap can replace the JS under a tab that
 * is midway through an IndexedDB upgrade, so the new worker waits and
 * `UpdatePrompt` asks first. The `message` handler below is how it says yes.
 *
 * Built by `serwist build serwist.config.mjs`, which runs after `next build` and
 * injects the precache manifest. Nothing here goes through Turbopack, which is
 * why it stays a build step of its own rather than a webpack plugin.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    /** Injected at build time: every hashed asset plus the prerendered HTML. */
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** The offline fallback, precached as part of the app's own HTML. */
const OFFLINE_URL = '/~offline';

/**
 * Long enough to ride out a slow handshake, short enough that a dead connection
 * does not hold a blank screen. Past this the cached shell answers.
 */
const NAVIGATION_TIMEOUT_S = 3;

const DAY_S = 24 * 60 * 60;

/**
 * Which rule a request falls under is decided in `lib/pwa/cache-policy.ts`,
 * where a test can reach it. This turns one of its answers into a matcher.
 */
function rule(want: CacheRule): RouteMatchCallback {
  return ({ url, request, sameOrigin }) =>
    classify({
      url,
      sameOrigin,
      isRsc: request.headers.get('RSC') === '1',
      isNavigation: request.mode === 'navigate',
    }) === want;
}

const runtimeCaching: RuntimeCaching[] = [
  {
    // First, and deliberately so, though the policy answers with exactly one
    // rule so no entry below could claim these anyway.
    matcher: rule('private'),
    handler: new NetworkOnly(),
  },
  {
    // Content-hashed by the build, so a URL's bytes never change and the cache
    // can answer without asking. This covers the JS chunks, the CSS and the
    // self-hosted font files next/font emits.
    matcher: rule('immutable'),
    handler: new CacheFirst({
      cacheName: 'tend-static',
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        // Deploys leave orphaned hashes behind. The cap collects them rather
        // than letting a year of deploys accumulate on someone's phone.
        new ExpirationPlugin({ maxEntries: 192, maxAgeSeconds: 30 * DAY_S, maxAgeFrom: 'last-used' }),
      ],
    }),
  },
  {
    // The payload a `next/link` navigation fetches. Same argument as the HTML:
    // client-rendered segments, so no user data is in it.
    matcher: rule('rsc'),
    handler: new NetworkFirst({
      cacheName: 'tend-rsc',
      networkTimeoutSeconds: NAVIGATION_TIMEOUT_S,
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 30 * DAY_S })],
    }),
  },
  {
    // A full page load. Network first so a deploy lands without waiting for the
    // next visit, cache second so a reload on a train still opens the app.
    matcher: rule('navigation'),
    handler: new NetworkFirst({
      cacheName: 'tend-pages',
      networkTimeoutSeconds: NAVIGATION_TIMEOUT_S,
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 30 * DAY_S })],
    }),
  },
  {
    // Everything left over, which includes the precached assets: they are served
    // from the precache before this is consulted, and a miss should go to the
    // network rather than into a second copy of the same bytes.
    matcher: rule('passthrough'),
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Serwist's own default precache name, deliberately. `cacheId` looks like the
  // way to rename it and is not: the constructor resolves the precache name
  // before it applies `cacheId`. The name also has to keep the `-precache-`
  // marker and the scope, because that is what `cleanupOutdatedCaches` matches
  // when it removes the previous version's copy on activate.
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: OFFLINE_URL,
        // Documents only. An API call that fails offline has to fail, so the
        // sync engine classifies it and retries. Handing it an HTML page would
        // read as a malformed response and could retire the batch.
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

serwist.addEventListeners();

/**
 * The other half of the update prompt. `UpdatePrompt` posts this after the
 * person accepts, the waiting worker activates, and the page reloads on
 * `controllerchange`.
 *
 * Serwist installs the same listener itself when `skipWaiting` is false. That
 * behaviour is not in its types, and the update flow failing silently on an
 * upgrade would present as a Reload button that reloads into the same old
 * version, so the contract is stated here rather than inherited.
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting();
});
