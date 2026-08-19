'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Whether this app can be installed here, and how.
 *
 * Three answers, because the three platforms work differently and pretending
 * otherwise produces a dead button. Chrome and Edge fire `beforeinstallprompt`
 * and hand over an object that opens the real install dialog, so there the app
 * can offer a one-tap install. Safari fires nothing at all and installing is a
 * manual gesture in the Share menu, so there the only honest thing to show is the
 * instruction. Everything else gets nothing rather than a guess.
 *
 * Installing matters more on iOS than the usual "nice to have": `PushManager`
 * does not exist in a Safari tab, so Add to Home Screen is what makes
 * notifications possible at all.
 *
 * Everything here reads the environment, which does not exist while the page is
 * being rendered on the server, so the reads go through `useSyncExternalStore`
 * with a server snapshot rather than through a state set from an effect. Display
 * mode is a real subscription too: launching the installed app changes the answer
 * without a reload.
 */

export type InstallMethod =
  /** The browser handed us a prompt to open. */
  | 'prompt'
  /** Share, then Add to Home Screen. Nothing can be automated. */
  | 'manual-ios'
  /** Already installed, or no way to. */
  | 'none';

/**
 * The event Chrome fires, which is not in lib.dom because it is not in any spec
 * TypeScript ships.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** False during server render and the hydrating pass, so nothing flashes. */
  ready: boolean;
  /** Running from the home screen or the dock rather than in a browser tab. */
  installed: boolean;
  method: InstallMethod;
  /** Opens the browser's install dialog. Only meaningful when method is 'prompt'. */
  install: () => Promise<boolean>;
}

const DISPLAY_MODE_QUERY = '(display-mode: standalone)';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // The media query is the standard. `navigator.standalone` is Safari's own,
  // predates it, and is still the only one iOS sets reliably.
  const iosLegacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.matchMedia(DISPLAY_MODE_QUERY).matches || iosLegacy;
}

function subscribeToDisplayMode(onChange: () => void): () => void {
  const query = window.matchMedia(DISPLAY_MODE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Nothing to subscribe to. The snapshot pair is the whole point. */
function subscribeToNothing(): () => void {
  return () => {};
}

const onClient = () => true;
const onServer = () => false;

/** iPadOS reports itself as a Mac, and only the touch count gives it away. */
function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
}

export function useInstall(): InstallState {
  const ready = useSyncExternalStore(subscribeToNothing, onClient, onServer);
  const standalone = useSyncExternalStore(subscribeToDisplayMode, isStandalone, onServer);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      // Without this the browser shows its own mini-infobar, and then there are
      // two prompts saying the same thing.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }

    // Installing does not move the tab you installed from into standalone mode,
    // so the media query keeps answering false and this is the only signal.
    function onInstalled() {
      setAccepted(true);
      setDeferred(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single use. Keeping it would give a button that works once.
    setDeferred(null);
    if (outcome === 'accepted') setAccepted(true);
    return outcome === 'accepted';
  }, [deferred]);

  const installed = standalone || accepted;
  const method: InstallMethod = installed
    ? 'none'
    : deferred
      ? 'prompt'
      : ready && isIos()
        ? 'manual-ios'
        : 'none';

  return { ready, installed, method, install };
}
