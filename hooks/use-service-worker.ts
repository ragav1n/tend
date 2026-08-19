'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Registers the service worker and reports when a new one is waiting.
 *
 * Registration is by hand rather than through `@serwist/window`, for two
 * reasons: the worker is built outside the app bundle so nothing injects a
 * registration entry for us, and the update flow is the whole point of this hook,
 * so it should be readable here rather than configured somewhere else.
 *
 * `skipWaiting` is off in `app/sw.ts`, which is what makes an "update ready"
 * state exist at all. A worker that takes over on its own can swap the JS under
 * a tab that is midway through an IndexedDB upgrade, and the failure that
 * produces is a corrupt local database rather than a bad render.
 *
 * Nothing here runs in development. The worker is built by `npm run build`, so
 * in `next dev` there is no `/sw.js` to register and asking for it would only
 * log a 404 on every page load.
 */

const SW_URL = '/sw.js';

/**
 * The browser checks for a new worker on navigation, and an installed PWA can go
 * a week without one. This is the backstop, on a timer long enough that it never
 * competes with the sync engine's own triggers.
 */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** If `controllerchange` never arrives, reload anyway rather than sit dead. */
const HANDOVER_GRACE_MS = 3_000;

export interface ServiceWorkerHandle {
  /** A new version is installed and waiting for permission to take over. */
  updateReady: boolean;
  /** Hands over to the waiting worker, then reloads onto the new assets. */
  applyUpdate: () => void;
}

export function useServiceWorker(): ServiceWorkerHandle {
  const [updateReady, setUpdateReady] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const container = navigator.serviceWorker;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    /**
     * An installed worker only counts as an update when this page already has a
     * controller. Without that check the very first install would prompt for a
     * reload seconds after arriving, which reads as the app being broken.
     */
    function watch(worker: ServiceWorker | null) {
      if (!worker) return;
      const check = () => {
        if (worker.state === 'installed' && container.controller) setUpdateReady(true);
      };
      worker.addEventListener('statechange', check);
      check();
    }

    function reload() {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    }

    function onVisible() {
      if (document.visibilityState === 'visible') void registration.current?.update();
    }

    container.addEventListener('controllerchange', reload);
    document.addEventListener('visibilitychange', onVisible);

    void container
      .register(SW_URL, { scope: '/' })
      .then((reg) => {
        if (cancelled) return;
        registration.current = reg;
        // A worker left waiting by an earlier visit, which is the common case:
        // the update installed, the person navigated away, and the prompt never
        // got its chance.
        watch(reg.waiting);
        watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
        timer = setInterval(() => void reg.update(), UPDATE_CHECK_MS);
      })
      .catch((error: unknown) => {
        // A failed registration costs the offline shell, not the app. Every read
        // still comes from IndexedDB.
        console.warn('[pwa] service worker registration failed', error);
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      container.removeEventListener('controllerchange', reload);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const waiting = registration.current?.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // The reload normally comes from `controllerchange`. This covers the case
    // where the message is dropped: a reload under the old worker just brings
    // the prompt back, which is a better outcome than a button that does nothing.
    setTimeout(() => {
      if (!reloading.current) {
        reloading.current = true;
        window.location.reload();
      }
    }, HANDOVER_GRACE_MS);
  }, []);

  return { updateReady, applyUpdate };
}
