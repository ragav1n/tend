'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db/client';
import { getSyncEngine, startSync } from '@/lib/sync/engine';
import { initialState, type SyncState } from '@/lib/sync/machine';
import { deadCount, pendingCount } from '@/lib/sync/outbox';

/**
 * The engine's state, as React state.
 *
 * `useSyncExternalStore` rather than an effect that copies into `useState`,
 * because the engine is a genuine external store: it changes from window
 * events, a Web Lock and network responses, none of which are renders. The
 * server snapshot is the initial state, so the badge renders "starting" during
 * hydration rather than mismatching.
 */
export function useSyncState(): SyncState {
  const engine = getSyncEngine();

  return useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.getState(),
    () => initialState,
  );
}

/** Starts the engine once for the tab. Safe to call from more than one place. */
export function useStartSync(): void {
  useEffect(() => {
    startSync();
  }, []);
}

export interface QueueCounts {
  pending: number;
  dead: number;
}

const ZERO: QueueCounts = { pending: 0, dead: 0 };

/**
 * How much is waiting to reach the server.
 *
 * Live rather than polled, so checking a task off offline updates the count on
 * the same frame the row animates.
 */
export function useQueueCounts(): QueueCounts {
  return (
    useLiveQuery(async () => {
      const db = getDb();
      const [pending, dead] = await Promise.all([pendingCount(db), deadCount(db)]);
      return { pending, dead };
    }, []) ?? ZERO
  );
}
