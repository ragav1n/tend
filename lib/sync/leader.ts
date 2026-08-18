/**
 * Exactly one tab syncs.
 *
 * Without an election, four open tabs each drain the same outbox. Every
 * mutation carries an idempotency key so the data survives, but the server sees
 * four times the traffic and three of the four tabs spend their time being told
 * "already applied".
 *
 * Web Locks is the right primitive because the browser releases the lock when
 * the tab dies, including a crash or a force quit. A lock held in localStorage
 * with a timestamp heartbeat, which is the usual hand-rolled version, leaves a
 * stale claim behind exactly when the tab did not get to clean up.
 *
 * Safari has had Web Locks since 15.4 and this app's floor is 16.4, so the
 * fallback below is for non-browser environments rather than real browsers.
 */

const LOCK_NAME = 'tend.sync.leader';

export interface LeaderHandle {
  release: () => void;
}

export function electLeader(onAcquired: () => void, onLost: () => void): LeaderHandle {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    // No election available, so assume leadership. One tab syncing twice is
    // better than no tab syncing at all.
    onAcquired();
    return { release: onLost };
  }

  let release: (() => void) | null = null;
  let released = false;

  void navigator.locks
    .request(LOCK_NAME, () => {
      onAcquired();
      // The lock is held for as long as this promise is pending. Resolving it
      // is the only way to hand leadership to another tab, which is why the
      // resolver is captured rather than the request being aborted: aborting a
      // signal after the lock is granted is ignored by the spec.
      return new Promise<void>((resolve) => {
        if (released) resolve();
        else release = resolve;
      });
    })
    .then(onLost, onLost);

  return {
    release: () => {
      released = true;
      release?.();
    },
  };
}
