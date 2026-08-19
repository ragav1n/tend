'use client';

import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { openDb, type TendDb } from '@/lib/db/client';
import { relieveQuota, requestPersistence } from '@/lib/db/persist';
import { getSupabase } from '@/lib/supabase/client';
import { readCursor } from './apply';
import { classify } from './errors';
import { electLeader, type LeaderHandle } from './leader';
import {
  initialState,
  reduce,
  type Effect,
  type SyncEvent,
  type SyncState,
} from './machine';
import { pullOnce } from './pull';
import { pushOnce } from './push';
import { reclaimStale } from './outbox';
import { installTriggers } from './triggers';
import { SyncError } from './transport';

/**
 * The machine wired to real effects.
 *
 * Everything that decides anything lives in `machine.ts`. This file only turns
 * effects into calls and results back into events, which is why it has no
 * branching worth testing and the reducer has 39 tests.
 *
 * One engine per tab, as a module singleton rather than React context, because
 * the triggers are window events and the leader election outlives any component.
 */

type Listener = (state: SyncState) => void;

export class SyncEngine {
  private state: SyncState = initialState;
  private listeners = new Set<Listener>();
  private db: TendDb | null = null;
  private leader: LeaderHandle | null = null;
  private teardown: (() => void) | null = null;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  /** Guards against two overlapping cycles when an effect resolves late. */
  private inFlight = false;

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.dispatch({ type: 'started' });
  }

  stop(): void {
    this.teardown?.();
    this.leader?.release();
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    this.teardown = null;
    this.leader = null;
    this.backoffTimer = null;
    this.started = false;
  }

  dispatch(event: SyncEvent): void {
    const { state, effects } = reduce(this.state, event);
    const changed = state !== this.state;
    this.state = state;
    if (changed) for (const listener of this.listeners) listener(state);
    for (const effect of effects) void this.run(effect);
  }

  private async run(effect: Effect): Promise<void> {
    switch (effect.kind) {
      case 'open_db':
        return this.openDatabase();
      case 'check_session':
        return this.checkSession();
      case 'acquire_leader':
        return this.acquireLeader();
      case 'push':
        return this.push();
      case 'pull':
        return this.pull();
      case 'schedule_backoff':
        this.backoffTimer = setTimeout(
          () => this.dispatch({ type: 'backoff_elapsed' }),
          effect.delayMs,
        );
        return;
      case 'cancel_backoff':
        if (this.backoffTimer) clearTimeout(this.backoffTimer);
        this.backoffTimer = null;
        return;
    }
  }

  private async openDatabase(): Promise<void> {
    let outcome;
    try {
      outcome = await openDb();
    } catch (error) {
      this.dispatch({
        type: 'db_failed',
        message: error instanceof Error ? error.message : 'could not open the database',
      });
      return;
    }

    // Three of the four failures have different fixes, and a single "sync
    // stopped" would hide which one applies here.
    switch (outcome.kind) {
      case 'blocked':
        this.dispatch({
          type: 'db_failed',
          message: 'Another tab is holding an older version open. Close it and reload.',
        });
        return;
      case 'stalled':
        this.dispatch({
          type: 'db_failed',
          message: 'The local database is taking too long to open. Reloading usually clears it.',
        });
        return;
      case 'stale_code':
        this.dispatch({
          type: 'db_failed',
          message: 'This page is older than the data on this device. Reload to catch up.',
        });
        return;
      case 'failed':
        this.dispatch({ type: 'db_failed', message: outcome.message });
        return;
      default:
        break;
    }

    this.db = outcome.db;

    // Moves the store out of the browser's evictable bucket. Nobody prompts for
    // it but Firefox, and an outbox that has not drained yet is the only copy of
    // that work, so it is worth asking.
    void requestPersistence();

    // A tab that died mid-push left records claimed. Nothing else ever
    // releases them, so the queue would strand while the UI said "synced".
    await reclaimStale(this.db);

    this.teardown = installTriggers(this.db, {
      onWake: () => this.dispatch({ type: 'wake' }),
      onOnline: () => this.dispatch({ type: 'network_online' }),
      onOffline: () => this.dispatch({ type: 'network_offline' }),
    });

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.dispatch({ type: 'network_offline' });
    }
    this.dispatch(
      outcome.kind === 'rebuilt'
        ? { type: 'db_opened', rescued: outcome.rescued }
        : { type: 'db_opened' },
    );
  }

  private async checkSession(): Promise<void> {
    const supabase = getSupabase();

    // getSession reads the stored token rather than calling the network, so it
    // still answers offline. getUser would not, and gating on it is how an
    // offline-first app ends up unusable on a plane.
    const { data } = await supabase.auth.getSession();

    supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'SIGNED_OUT' || !session) {
        this.dispatch({ type: 'session_lost' });
        return;
      }
      void this.announceSession();
    });

    if (!data.session) {
      this.dispatch({ type: 'session_lost' });
      return;
    }
    await this.announceSession();
  }

  private async announceSession(): Promise<void> {
    const cursor = this.db ? await readCursor(this.db) : 0;
    this.dispatch({ type: 'session_found', cursor });
  }

  private async acquireLeader(): Promise<void> {
    this.leader = electLeader(
      () => this.dispatch({ type: 'leader_acquired' }),
      () => this.dispatch({ type: 'leader_lost' }),
    );
  }

  /**
   * The guard covers the awaited request and nothing else.
   *
   * Clearing it in a `finally` after dispatching looks equivalent and is not:
   * the event dispatched inside the try produces the next effect synchronously,
   * that effect sees the flag still set, and drops itself. The cycle then dies
   * one step in, with no error and no retry, and the badge sits on "Setting up"
   * forever. Every settled event below is dispatched after the flag is down.
   */
  private async push(): Promise<void> {
    if (!this.db || this.inFlight) return;
    this.inFlight = true;

    let outcome;
    try {
      outcome = await pushOnce(this.db);
    } catch (error) {
      this.inFlight = false;
      this.fail(error);
      return;
    }

    this.inFlight = false;
    this.dispatch({ type: 'push_settled', cursor: outcome.cursor });
  }

  private async pull(): Promise<void> {
    if (!this.db || this.inFlight) return;
    this.inFlight = true;

    let outcome;
    try {
      outcome = await pullOnce(this.db);
    } catch (error) {
      this.inFlight = false;
      this.fail(error);
      return;
    }

    this.inFlight = false;
    this.dispatch({
      type: 'pull_settled',
      cursor: outcome.cursor,
      hasMore: outcome.hasMore,
    });
  }

  private fail(error: unknown): void {
    const failure = error instanceof SyncError ? error.failure : classify(error);
    this.dispatch({ type: 'failed', kind: failure.kind, message: failure.message });
    // paused_quota has no exit of its own, because nothing else in the app ever
    // deletes anything. Trimming the local-only logs is the only exit that does
    // not cost the person data, so if it frees nothing the engine stays parked
    // and the badge keeps saying storage is full.
    if (failure.kind === 'quota') void this.relieve();
  }

  private async relieve(): Promise<void> {
    if (!this.db) return;
    try {
      if ((await relieveQuota(this.db)) > 0) this.dispatch({ type: 'quota_cleared' });
    } catch {
      // Pruning failed too. Staying paused is the correct outcome.
    }
  }
}

let engine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  engine ??= new SyncEngine();
  return engine;
}

/** Called by the shell once on mount. Idempotent. */
export function startSync(): void {
  getSyncEngine().start();
}
