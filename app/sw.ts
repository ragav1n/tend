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
 * `lib/pwa/updates.ts` asks first. The `message` handler below is how it says
 * yes.
 *
 * The `push` and `notificationclick` handlers at the bottom are the other half of
 * the reminder pipeline. Postgres decides who to tell and when, the cron route
 * sends, and this is where it lands.
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
  // Off, because every view is precached. Navigation preload starts a network
  // request in parallel with the worker booting, which pays for itself only when
  // the handler consults `event.preloadResponse`. The precache route answers
  // navigations here and does not, so leaving this on would fire a request per
  // navigation and throw the answer away.
  navigationPreload: false,
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
 * The other half of the update prompt. `lib/pwa/updates.ts` posts this after the
 * person accepts, and then waits: for `controllerchange`, or for this worker to
 * reach `activated`. It must not reload before one of those, because a reload
 * under the outgoing worker is answered from the precache below and comes back
 * on the version it was trying to leave.
 *
 * Serwist installs the same listener itself when `skipWaiting` is false. That
 * behaviour is not in its types, and the update flow failing silently on an
 * upgrade would present as a Reload button that reloads into the same old
 * version, so the contract is stated here rather than inherited.
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting();
});

/**
 * A reminder arriving from the push service.
 *
 * `userVisibleOnly` was true at subscribe time, which is a promise that every
 * push shows a notification. A handler that decides not to spends the browser's
 * patience: Chrome shows its own "this site has been updated in the background"
 * after a few silent pushes and can revoke the permission. So the fallback text
 * exists to be shown rather than to be correct: anything that arrives without a
 * readable payload still gets a notification.
 *
 * `event.waitUntil` is not optional. Without it the worker can be killed between
 * the handler returning and showNotification resolving, and the notification
 * simply never appears.
 */
self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(show(event.data));
});

interface Message {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

async function show(data: PushMessageData | null): Promise<void> {
  let message: Message = {};
  try {
    message = (data?.json() ?? {}) as Message;
  } catch {
    // Not JSON. Anything that reaches here is either a bug in the sender or
    // somebody else's push, and the promise above still has to be kept.
  }

  await self.registration.showNotification(message.title ?? 'Tend', {
    body: message.body ?? 'Something needs doing.',
    // Only the "any" icon: the launcher's mask does not apply here, so the
    // maskable one would show as a full-bleed square with its ink pulled in.
    icon: '/icons/icon-192.png',
    badge: '/icons/maskable-192.png',
    // Replaces rather than stacks, so a second digest updates the first.
    tag: message.tag ?? 'tend',
    // The tag alone replaces silently, and a reminder is worth a buzz. `renotify`
    // is in the notifications spec and not in TypeScript's NotificationOptions,
    // which is why this needs the cast rather than because anything here is
    // dubious. Ignored where it is unsupported.
    renotify: true,
    data: { url: message.url ?? '/today' },
  } as NotificationOptions & { renotify: boolean });
}

/**
 * Tapping the notification.
 *
 * An already-open window is focused and navigated rather than a second one being
 * opened, because the app is a single installed thing and two copies of it means
 * two IndexedDB connections and a leader election that has to settle. `openWindow`
 * is the fallback for a cold tap, which on a phone is the normal case.
 */
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | null)?.url ?? '/today';

  event.waitUntil(
    (async () => {
      const url = new URL(target, self.location.origin);
      const clients = await self.clients.matchAll({
        type: 'window',
        // Without this, a client the worker does not yet control is invisible
        // here, and the app opens a second window over the one already showing.
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if (new URL(client.url).origin !== url.origin) continue;
        await client.focus();
        // `navigate` is only allowed on a client this worker controls, and
        // `includeUncontrolled` above means some of them are not. Focusing
        // already worked, so an uncontrolled client lands on whatever page it was
        // showing, which beats letting the rejection escape and abandoning the
        // tap after the window is already up.
        if ('navigate' in client) {
          try {
            await client.navigate(url.href);
          } catch {
            // Focused but not steered. Nothing further to try.
          }
        }
        return;
      }

      await self.clients.openWindow(url.href);
    })(),
  );
});
