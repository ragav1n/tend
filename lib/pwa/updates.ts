import { APP_VERSION } from '@/lib/version';

/**
 * Whether this tab is running the version that is deployed, and how to get onto
 * it if not.
 *
 * Two signals, because neither one answers the question on its own. The service
 * worker knows a new worker has installed and is waiting, which is the thing
 * that can actually be swapped in, but it only learns that on a navigation or
 * its own hourly check and it cannot say what version it found. `/api/version`
 * is answered by the live deployment, so it names the current version straight
 * away, but it cannot swap anything. An update is available when either one
 * says so.
 *
 * The logic lives here rather than in the hook for the reason `cache-policy.ts`
 * does: a service worker handover cannot be reproduced in a test through React,
 * and the part that gets this wrong is the sequencing, not the rendering.
 *
 * The sequencing rule, which is the whole point of this file: **never reload
 * before the new worker is in charge.** `skipWaiting` is off, so a reload issued
 * while the old worker is still controlling the page is served the old
 * precache, comes back on the same version, and puts the prompt straight back
 * up. That reads as an update button that flickers and does nothing. So the
 * reload waits for `controllerchange`, or for the waiting worker to reach
 * `activated`, and the timeout that covers a dropped message is long enough for
 * an activation that has an old cache to clean up.
 */

export type UpdateStatus =
  /** Nothing has been checked yet. */
  | 'unknown'
  | 'checking'
  /** This tab is on the deployed version. */
  | 'current'
  /** A newer version is deployed, and can be applied. */
  | 'available'
  /** Handing over to the new worker. A reload follows. */
  | 'applying'
  /** An apply came back on the same version. The next one clears the caches. */
  | 'failed';

export interface UpdateState {
  status: UpdateStatus;
  /** What this tab was built as. Empty outside a Next build. */
  version: string;
  /** What the deployment reports, once a check has reached it. */
  latest: string | null;
  /** When the last check landed, as an epoch millisecond count. */
  checkedAt: number | null;
  /** The last check could not reach the server. */
  offline: boolean;
}

export interface UpdateEnvironment {
  version: string;
  /** Null where the browser has no service workers, and in dev where none is built. */
  container: ServiceWorkerContainer | null;
  register: () => Promise<ServiceWorkerRegistration | null>;
  /** The deployed version, or null when the request did not land. */
  fetchLatest: () => Promise<string | null>;
  reload: () => void;
  /** Per tab, so an attempt survives the reload it triggers. */
  session: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Drops the caches that can serve an old page. Never the precache. */
  clearPageCaches: () => Promise<void>;
}

export interface UpdateManager {
  subscribe: (listener: () => void) => () => void;
  getState: () => UpdateState;
  /** Registers the worker and starts checking. Safe to call from anywhere. */
  start: () => void;
  /** `force` skips the throttle, which is what the button in settings needs. */
  check: (options?: { force?: boolean }) => Promise<void>;
  apply: () => Promise<void>;
}

const ATTEMPT_KEY = 'tend.update.attempt';

/** The backstop, for a tab left open all day. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The floor on how often coming back to the app may ask. Browsers do not
 * throttle an explicit `update()`, so an unguarded visibility handler turns
 * every alt-tab into two requests.
 *
 * Under the interval on purpose. At the same value the timer's own tick races
 * the throttle its predecessor set and loses about half the time, which turns
 * an hourly backstop into a two-hourly one.
 */
const CHECK_THROTTLE_MS = 55 * 60 * 1000;

/** A check that never reached the server is worth repeating sooner than one
 *  that got an answer. */
const OFFLINE_RETRY_MS = 5 * 60 * 1000;

/**
 * How long a handover gets before the reload happens anyway.
 *
 * Generous on purpose. Activation waits for the old worker to finish its
 * in-flight requests and then deletes the previous precache, which on a phone
 * with a full cache is seconds rather than milliseconds. The old three seconds
 * here reloaded straight into the old worker and the prompt came back.
 */
const HANDOVER_TIMEOUT_MS = 15_000;

/** How long `update()` gets to produce a waiting worker before giving up on a
 *  clean handover and reloading instead. */
const INSTALL_WAIT_MS = 3_000;

/**
 * How long a reload gets to actually end this page.
 *
 * Normally nothing after `reload()` runs. When something defers it the manager
 * would otherwise sit at `applying` forever: every check returns early, every
 * `settle` returns early, and the button in settings is disabled with no way
 * back. This puts a floor under that.
 */
const RELOAD_GRACE_MS = 10_000;

/**
 * What a second attempt drops.
 *
 * These two are NetworkFirst, so they only answer when the network does not,
 * and a slow connection that trips the 3 second timeout is one way a reload
 * lands on yesterday's HTML. They are a plausible cause rather than a known
 * one: the precache answers a navigation first and is the likelier culprit, and
 * it is deliberately not here, because deleting it out from under its own
 * active worker leaves the app with no offline shell until the next install.
 * So this is a safe second try, not a cure. Both caches rebuild from the
 * network and neither holds a row.
 */
const PAGE_CACHES = ['tend-pages', 'tend-rsc'];

const VERSION_URL = '/api/version';

export function createUpdateManager(env: UpdateEnvironment): UpdateManager {
  let state: UpdateState = {
    status: 'unknown',
    version: env.version,
    latest: null,
    checkedAt: null,
    offline: false,
  };

  const listeners = new Set<() => void>();
  let registration: ServiceWorkerRegistration | null = null;
  let started = false;
  let nextCheck = 0;
  /** Any check has finished, however it went. Without this a browser with no
   *  service worker and no network never leaves `checking`, and the button in
   *  settings stays disabled for the life of the tab. */
  let everChecked = false;
  let attempts = 0;
  let applying = false;
  let reloading = false;
  let hadController = false;
  /**
   * A worker that reached `installed` while this page had a controller.
   *
   * Tracked alongside `registration.waiting` rather than trusting it alone: the
   * spec queues the state change and the registration's own `waiting` update as
   * separate tasks, so a `statechange` handler can run while `waiting` is still
   * null.
   */
  let pending: ServiceWorker | null = null;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function set(patch: Partial<UpdateState>): void {
    const next = { ...state, ...patch };
    if (
      next.status === state.status &&
      next.latest === state.latest &&
      next.checkedAt === state.checkedAt &&
      next.offline === state.offline
    ) {
      return;
    }
    state = next;
    emit();
  }

  function reloadOnce(): void {
    if (reloading) return;
    reloading = true;
    env.reload();

    // Only reached when the reload did not happen. Hand the tab back its
    // controls rather than leaving it frozen mid-update.
    setTimeout(() => {
      reloading = false;
      applying = false;
      settle();
    }, RELOAD_GRACE_MS);
  }

  /** A version comparison is only meaningful when both sides have one. */
  function deploymentIsOther(): boolean {
    return state.latest !== null && env.version !== '' && state.latest !== env.version;
  }

  function waiting(): ServiceWorker | null {
    return registration?.waiting ?? pending;
  }

  function hasUpdate(): boolean {
    return waiting() !== null || deploymentIsOther();
  }

  /** Turns the facts into a status. Called after anything that changes them. */
  function settle(): void {
    // A reload is already on its way. Anything else would flash a status that
    // is about to be replaced by a fresh page.
    if (applying) return;

    if (hasUpdate()) {
      set({ status: attempts > 0 ? 'failed' : 'available' });
      return;
    }

    // Nothing waiting and the deployment matches, so an earlier attempt landed
    // after all. This is the only place an attempt is forgotten, and it waits
    // for a check: `start` settles once as soon as the registration resolves,
    // which is before the first answer is in, and forgetting there would wipe
    // the record of exactly the failure the escalation exists for. An apply
    // that found no worker to hand over to reloads with nothing waiting, so a
    // premature settle sees no update, clears the attempt, and the retry after
    // it repeats the first try instead of clearing the caches.
    if (attempts > 0 && everChecked) forgetAttempt();
    if (everChecked || registration !== null) set({ status: 'current' });
  }

  function watch(worker: ServiceWorker | null): void {
    if (!worker) return;

    const look = () => {
      if (worker.state === 'installed' && hadController) {
        const isNew = pending !== worker;
        pending = worker;
        // The worker found the update, so `latest` is only as fresh as the last
        // check and can still be this tab's own version. Ask before announcing,
        // or the prompt offers "Version 0.34.0" to somebody running 0.34.0.
        // `check` settles the status on its way out, including when it fails.
        if (isNew && !deploymentIsOther()) {
          void check({ force: true });
          return;
        }
        settle();
        return;
      }
      if (worker.state === 'activated' || worker.state === 'redundant') {
        if (pending === worker) pending = null;
      }
      settle();
    };

    worker.addEventListener('statechange', look);
    look();
  }

  // ── The attempt, which is what stops a flicker from repeating ──────────────
  // An apply writes down the version it was trying to leave. If the tab comes
  // back on that same version the update did not take, and the next apply
  // clears the page caches before handing over rather than repeating itself.
  //
  // Keyed on the version, so a deploy that did not bump package.json would read
  // as a failed attempt. The repo rule is to bump on every change, which is
  // what makes the version usable as the identity of a build.

  function readAttempt(): void {
    if (env.version === '' || !env.session) return;
    const raw = env.session.getItem(ATTEMPT_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as { from?: unknown; count?: unknown };
      if (parsed.from !== env.version) {
        forgetAttempt();
        return;
      }
      attempts = typeof parsed.count === 'number' ? parsed.count : 0;
    } catch {
      forgetAttempt();
    }
  }

  function writeAttempt(): void {
    if (env.version === '' || !env.session) return;
    env.session.setItem(ATTEMPT_KEY, JSON.stringify({ from: env.version, count: attempts }));
  }

  function forgetAttempt(): void {
    attempts = 0;
    env.session?.removeItem(ATTEMPT_KEY);
  }

  async function check(options: { force?: boolean } = {}): Promise<void> {
    if (applying) return;
    const at = Date.now();
    if (!options.force && at < nextCheck) return;
    nextCheck = at + CHECK_THROTTLE_MS;
    set({ status: 'checking' });

    const [latest] = await Promise.all([
      env.fetchLatest(),
      registration?.update().catch(() => undefined) ?? Promise.resolve(),
    ]);

    // A failed request means the network, not a version. Holding the last known
    // answer beats replacing it with a guess, and the next attempt comes sooner
    // than an hour because being offline is a state that ends.
    if (latest === null) {
      nextCheck = Date.now() + OFFLINE_RETRY_MS;
      set({ offline: true });
    } else {
      set({ latest, checkedAt: Date.now(), offline: false });
    }

    everChecked = true;
    settle();
  }

  /** The worker to hand over to, asking for one if none has installed yet. */
  async function handoverTarget(): Promise<ServiceWorker | null> {
    if (waiting()) return waiting();
    if (!registration) return null;

    await registration.update().catch(() => undefined);

    const deadline = Date.now() + INSTALL_WAIT_MS;
    while (!waiting() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return waiting();
  }

  async function apply(): Promise<void> {
    if (applying) return;
    applying = true;
    set({ status: 'applying' });

    attempts += 1;
    writeAttempt();

    if (attempts > 1) await env.clearPageCaches().catch(() => undefined);

    const worker = await handoverTarget();
    if (!worker) {
      // Nothing installed to hand over to, which means the only evidence was
      // the deployment reporting another version. A navigation is network
      // first, so a plain reload fetches it.
      reloadOnce();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reloadOnce();
    };

    // Covers a dropped message and a worker that installs but never activates.
    // Reloading under the old worker brings the prompt back, which is a worse
    // outcome than waiting, and the only one worse than that is a button that
    // does nothing at all.
    const timer = setTimeout(finish, HANDOVER_TIMEOUT_MS);

    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') finish();
    });
    // `controllerchange` fires first in a normal handover: the spec swaps the
    // controller during activation, before the worker's state reaches
    // `activated`. The listener registered in `start` catches it.
    env.container?.addEventListener('controllerchange', finish, { once: true });

    worker.postMessage({ type: 'SKIP_WAITING' });
  }

  function start(): void {
    if (started) return;
    started = true;

    readAttempt();

    const container = env.container;
    let registered: Promise<void> = Promise.resolve();

    if (container) {
      hadController = container.controller !== null;

      // Another tab accepted the update, or this one did. Either way the page is
      // now running old JS against a new worker and a new precache, so it
      // reloads rather than staying on a version that is no longer installed.
      // Guarded on there having been a controller, so a first install cannot
      // reload somebody seconds after they arrive.
      container.addEventListener('controllerchange', () => {
        if (hadController) reloadOnce();
      });

      registered = env.register().then((reg) => {
        registration = reg;
        if (!reg) return;
        // A worker left waiting by an earlier visit, which is the common case:
        // the update installed, the tab was closed, and nothing asked.
        watch(reg.waiting);
        watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
        settle();
      });
    }

    // After the registration, never beside it. A check that runs first has no
    // registration to call `update()` on, so the one check every visit is
    // guaranteed to make would ask the deployment and never ask the worker.
    void registered.then(() => check({ force: true }));

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check();
      });
    }
    if (typeof setInterval !== 'undefined') {
      setInterval(() => void check(), CHECK_INTERVAL_MS);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    start,
    check,
    apply,
  };
}

// ── The browser's one ─────────────────────────────────────────────────────────

/** What a server render and the hydrating pass both see. */
export const INITIAL_STATE: UpdateState = {
  status: 'unknown',
  version: APP_VERSION,
  latest: null,
  checkedAt: null,
  offline: false,
};

let singleton: UpdateManager | null = null;

export function getUpdateManager(): UpdateManager {
  singleton ??= createUpdateManager(browserEnvironment());
  return singleton;
}

function browserEnvironment(): UpdateEnvironment {
  const supported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    // Nothing builds `/sw.js` in dev, so registering there logs a 404 on every
    // page load and reports a worker that will never exist.
    process.env.NODE_ENV === 'production';

  return {
    version: APP_VERSION,
    container: supported ? navigator.serviceWorker : null,
    register: async () => {
      if (!supported) return null;
      try {
        return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (error) {
        // A failed registration costs the offline shell, not the app: every read
        // still comes from IndexedDB. The version check keeps working.
        console.warn('[pwa] service worker registration failed', error);
        return null;
      }
    },
    fetchLatest: async () => {
      try {
        const response = await fetch(VERSION_URL, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { version?: unknown };
        return typeof body.version === 'string' ? body.version : null;
      } catch {
        return null;
      }
    },
    reload: () => window.location.reload(),
    session: typeof sessionStorage === 'undefined' ? null : sessionStorage,
    clearPageCaches: async () => {
      if (typeof caches === 'undefined') return;
      await Promise.all(PAGE_CACHES.map((name) => caches.delete(name)));
    },
  };
}
