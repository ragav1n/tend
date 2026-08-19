'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Turning notifications on for this browser.
 *
 * Per device on purpose, and that is why there is no synced setting behind it.
 * Notification permission belongs to a browser profile, so a subscription row is
 * the state: turning it off on a laptop should not turn it off on a phone, and a
 * synced boolean would make it do exactly that.
 *
 * `PushManager` does not exist in a Safari tab, only in an installed app, so the
 * capability check does the iOS gating on its own. What it cannot do is explain
 * itself, which is why `reason` says why it is unavailable and settings shows the
 * Home Screen step rather than a dead switch.
 *
 * Nothing here asks for permission on its own. A notification prompt on load is
 * the fastest way to a permanent block, and a block is not something an app can
 * undo: only the person can, in browser settings, which almost nobody does. So the
 * request happens on a tap and nowhere else.
 */

export type PushAvailability =
  | 'ready'
  /** No service worker or no PushManager. On iOS this means "not installed". */
  | 'unsupported'
  /** The build has no VAPID public key, so a subscription could never be used. */
  | 'unconfigured'
  /** Permission was refused. Only the person can reverse this. */
  | 'blocked'
  /**
   * The browser can do this and no worker is registered, so there is nothing to
   * deliver to. Always the case in `next dev`, where the worker is not built, and
   * the honest answer in production when registration failed.
   */
  | 'no-worker';

export interface PushState {
  /** False until the browser has been asked, so nothing renders a wrong answer. */
  ready: boolean;
  availability: PushAvailability;
  subscribed: boolean;
  busy: boolean;
  /** Asks for permission, subscribes, and registers with the server. */
  enable: () => Promise<boolean>;
  disable: () => Promise<void>;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/**
 * The key travels as base64url and `applicationServerKey` wants bytes.
 * `atob` needs the standard alphabet and the padding put back.
 *
 * Typed as ArrayBuffer rather than Uint8Array because TypeScript's Uint8Array is
 * generic over its buffer since 5.7, and the union `applicationServerKey` accepts
 * excludes a view that might sit on a SharedArrayBuffer.
 */
function decodeKey(base64url: string): ArrayBuffer {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes.buffer;
}

function availabilityNow(): PushAvailability {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  if (Notification.permission === 'denied') return 'blocked';
  return 'ready';
}

export function usePush(): PushState {
  const [ready, setReady] = useState(false);
  const [availability, setAvailability] = useState<PushAvailability>('unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;

    async function look() {
      const state = availabilityNow();
      if (state !== 'ready') return { state, has: false };

      // `getRegistration` before `ready`, because `ready` never settles when
      // nothing is registered. Awaiting it first would leave this hook forever
      // un-ready and the settings row on a dash with no explanation, which is
      // every `next dev` session and any production load where registration
      // failed.
      const registered = await navigator.serviceWorker.getRegistration('/');
      if (!registered) return { state: 'no-worker' as const, has: false };

      const registration = await navigator.serviceWorker.ready;
      return { state, has: (await registration.pushManager.getSubscription()) !== null };
    }

    void look().then(({ state, has }) => {
      if (!live) return;
      setAvailability(state);
      setSubscribed(has);
      setReady(true);
    });

    return () => {
      live = false;
    };
  }, []);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!VAPID_PUBLIC_KEY) return false;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setAvailability(permission === 'denied' ? 'blocked' : 'ready');
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      // Re-subscribing with the same options returns the existing subscription
      // rather than a second one, so this is safe to call when one already exists.
      const subscription = await registration.pushManager.subscribe({
        // Required by Chrome, and a promise: every push must show something.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(VAPID_PUBLIC_KEY),
      });

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!response.ok) {
        // The browser subscription without a row on the server is a device that
        // thinks it is subscribed and never hears anything, so it is undone.
        await subscription.unsubscribe();
        return false;
      }

      setSubscribed(true);
      setAvailability('ready');
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // The server first. A row left behind keeps the push channel open in the
        // claim, which would hold back the email for somebody who now gets
        // neither.
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, []);

  return { ready, availability, subscribed, busy, enable, disable };
}
