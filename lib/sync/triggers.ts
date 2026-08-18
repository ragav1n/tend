import type { TendDb } from '@/lib/db/client';

/**
 * Everything that should start a sync cycle.
 *
 * Background Sync is a bonus rather than the mechanism. iOS Safari has neither
 * Background Sync nor Periodic Background Sync, so foreground triggers are the
 * primary path on every platform and the contract is that a flush begins within
 * 200ms of the app becoming visible and online.
 *
 * The local-mutation trigger watches the outbox rather than being called from
 * `mutations.ts`. That keeps the dependency pointing one way: sync knows about
 * the write API, and the write API has never heard of sync.
 */

/** A burst of edits should cost one cycle, not one per keystroke. */
export const MUTATION_DEBOUNCE_MS = 500;

/** Backstop while the tab is visible, for anything the events above missed. */
export const VISIBLE_TICK_MS = 60_000;

export interface TriggerCallbacks {
  onWake: () => void;
  onOnline: () => void;
  onOffline: () => void;
}

export function installTriggers(db: TendDb, callbacks: TriggerCallbacks): () => void {
  const { onWake, onOnline, onOffline } = callbacks;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;

  function wakeSoon() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(onWake, MUTATION_DEBOUNCE_MS);
  }

  function onVisibility() {
    if (document.visibilityState !== 'visible') {
      if (tick) clearInterval(tick);
      tick = null;
      return;
    }
    // Immediate rather than debounced: coming back to the app is the moment the
    // 200ms contract is measured from.
    onWake();
    tick ??= setInterval(onWake, VISIBLE_TICK_MS);
  }

  // A local write lands in the outbox before this fires, so by the time the
  // debounce elapses the record is already claimable.
  const creating = () => wakeSoon();
  db.outbox.hook('creating', creating);

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', onWake);
  // pageshow rather than load, so a restore from the back-forward cache counts.
  // On iOS that is how the app usually comes back.
  window.addEventListener('pageshow', onWake);
  document.addEventListener('visibilitychange', onVisibility);

  onVisibility();

  return () => {
    if (debounce) clearTimeout(debounce);
    if (tick) clearInterval(tick);
    db.outbox.hook('creating').unsubscribe(creating);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('pageshow', onWake);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
