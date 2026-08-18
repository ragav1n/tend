import { backoffDelay, type FailureKind } from './errors';

/**
 * The sync engine as a pure reducer.
 *
 * Zero I/O lives here. `reduce` takes the current state and one event and
 * returns the next state plus a list of effects for the engine to carry out.
 * That split is the whole reason this is testable: every interleaving worth
 * worrying about (a tab losing the lock mid-push, the network dropping during
 * backoff, a session expiring while a pull is in flight) is three lines of test
 * instead of a mocked fetch and a timer.
 *
 * The invariant the whole design rests on: **push always precedes pull inside a
 * cycle.** Pulling first would apply a server row over a local edit that has not
 * been sent yet, and the local edit would be gone with nothing left to resend.
 *
 * The other rule worth stating: losing the session never touches the outbox. An
 * expired refresh token halts sync and shows a re-login prompt over a fully
 * working app that keeps reading and queuing writes. Nothing here ever clears
 * queued work.
 */

export type SyncStatus =
  | 'boot'
  | 'opening_db'
  /** Signed out. The app still reads and still queues writes. */
  | 'no_session'
  /** Another tab holds the lock. This one reads and queues only. */
  | 'follower'
  | 'offline'
  /** First cycle for this device, meaning the cursor is still 0. */
  | 'hydrating'
  | 'pushing'
  | 'pulling'
  | 'idle'
  | 'backoff'
  /** The refresh token expired. Sync stops, the app does not. */
  | 'reauth_required'
  /** IndexedDB is full. Pulling more would fail, so the cycle waits. */
  | 'paused_quota'
  | 'fatal';

export interface SyncState {
  status: SyncStatus;
  /** Highest row_version applied. 0 means this device has never synced. */
  cursor: number;
  /** Consecutive retryable failures. Drives the backoff delay. */
  attempts: number;
  /** A trigger fired while a cycle was running, so run one more when it lands. */
  wakePending: boolean;
  online: boolean;
  leader: boolean;
  session: boolean;
  dbOpen: boolean;
  /** The last failure, kept so the badge can explain itself. */
  lastError: string | null;
}

export type SyncEvent =
  | { type: 'started' }
  | { type: 'db_opened' }
  | { type: 'db_failed'; message: string }
  | { type: 'session_found'; cursor: number }
  | { type: 'session_lost' }
  | { type: 'leader_acquired' }
  | { type: 'leader_lost' }
  | { type: 'network_online' }
  | { type: 'network_offline' }
  /** A trigger fired: visibility, focus, a local mutation, or the timer. */
  | { type: 'wake' }
  | { type: 'push_settled'; cursor: number }
  | { type: 'pull_settled'; cursor: number; hasMore: boolean }
  | { type: 'failed'; kind: FailureKind; message: string }
  | { type: 'backoff_elapsed' }
  | { type: 'quota_cleared' };

export type Effect =
  | { kind: 'open_db' }
  | { kind: 'check_session' }
  | { kind: 'acquire_leader' }
  | { kind: 'push' }
  | { kind: 'pull' }
  | { kind: 'schedule_backoff'; delayMs: number }
  | { kind: 'cancel_backoff' };

export interface Transition {
  state: SyncState;
  effects: Effect[];
}

export const initialState: SyncState = {
  status: 'boot',
  cursor: 0,
  attempts: 0,
  wakePending: false,
  online: true,
  leader: false,
  session: false,
  dbOpen: false,
  lastError: null,
};

/** True while a cycle is in flight, which is when a wake has to be deferred. */
export function isBusy(status: SyncStatus): boolean {
  return status === 'pushing' || status === 'pulling' || status === 'hydrating';
}

/** Statuses the engine will not leave without an explicit event. */
function isHalted(status: SyncStatus): boolean {
  return status === 'reauth_required' || status === 'fatal' || status === 'paused_quota';
}

/**
 * Where the machine comes to rest given its flags, in priority order. Signed
 * out beats not-leader beats offline, because that is the order in which the
 * reasons are worth showing a user.
 */
function restingStatus(state: SyncState): SyncStatus {
  if (!state.dbOpen) return 'opening_db';
  if (!state.session) return 'no_session';
  if (!state.leader) return 'follower';
  if (!state.online) return 'offline';
  return 'idle';
}

function rest(state: SyncState): Transition {
  return { state: { ...state, status: restingStatus(state) }, effects: [] };
}

/** Starts a cycle if the flags allow one, and otherwise comes to rest. */
function beginCycle(state: SyncState): Transition {
  if (restingStatus(state) !== 'idle') {
    // The wake is remembered rather than dropped, so becoming leader or coming
    // back online runs the cycle that could not run before.
    return { state: { ...state, status: restingStatus(state), wakePending: true }, effects: [] };
  }
  return {
    state: {
      ...state,
      status: state.cursor === 0 ? 'hydrating' : 'pushing',
      wakePending: false,
    },
    effects: [{ kind: 'push' }],
  };
}

export function reduce(state: SyncState, event: SyncEvent): Transition {
  switch (event.type) {
    case 'started':
      return { state: { ...state, status: 'opening_db' }, effects: [{ kind: 'open_db' }] };

    case 'db_opened':
      return {
        state: { ...state, dbOpen: true },
        effects: [{ kind: 'check_session' }, { kind: 'acquire_leader' }],
      };

    case 'db_failed':
      // No local store means no app at all, which is the one thing worth
      // calling fatal. Everything else degrades to "works offline".
      return { state: { ...state, status: 'fatal', lastError: event.message }, effects: [] };

    case 'session_found': {
      const next = { ...state, session: true, cursor: event.cursor, lastError: null };
      // Signing in is itself a reason to sync, so it does not wait for a wake.
      return beginCycle(next);
    }

    case 'session_lost':
      // The outbox is deliberately untouched. Queued work waits for a session
      // rather than being thrown away.
      return { state: { ...state, session: false, status: 'no_session' }, effects: [] };

    case 'leader_acquired': {
      const next = { ...state, leader: true };
      return next.wakePending || next.session ? beginCycle(next) : rest(next);
    }

    case 'leader_lost':
      // Whatever was in flight is abandoned rather than finished. The new leader
      // re-reads the outbox, and every mutation carries an idempotency key, so
      // a half-sent batch costs one duplicate request and no duplicate rows.
      return { state: { ...state, leader: false, status: 'follower' }, effects: [] };

    case 'network_offline':
      return {
        state: { ...state, online: false, status: 'offline', attempts: 0 },
        effects: [{ kind: 'cancel_backoff' }],
      };

    case 'network_online': {
      const next = { ...state, online: true, attempts: 0 };
      if (isHalted(next.status)) return { state: next, effects: [] };
      // Coming back online is always worth a cycle: the whole point of the
      // offline queue is that it drains the moment it can.
      return beginCycle(next);
    }

    case 'wake': {
      if (isHalted(state.status)) return { state, effects: [] };
      if (isBusy(state.status)) {
        // Coalesced rather than queued. Ten triggers during one push produce
        // one extra cycle, not ten.
        return { state: { ...state, wakePending: true }, effects: [] };
      }
      if (state.status === 'backoff') {
        // A user-visible action beats waiting out a backoff, so the timer is
        // cancelled and the cycle runs now.
        return (() => {
          const started = beginCycle({ ...state, attempts: 0 });
          return { state: started.state, effects: [{ kind: 'cancel_backoff' }, ...started.effects] };
        })();
      }
      return beginCycle(state);
    }

    case 'push_settled': {
      if (!isBusy(state.status)) return { state, effects: [] };
      return {
        state: {
          ...state,
          cursor: Math.max(state.cursor, event.cursor),
          status: state.status === 'hydrating' ? 'hydrating' : 'pulling',
          attempts: 0,
          lastError: null,
        },
        effects: [{ kind: 'pull' }],
      };
    }

    case 'pull_settled': {
      if (!isBusy(state.status)) return { state, effects: [] };
      const next = {
        ...state,
        cursor: Math.max(state.cursor, event.cursor),
        attempts: 0,
        lastError: null,
      };
      // Paging stays inside the cycle. Stopping at a page boundary and waiting
      // for a trigger would leave the client silently behind.
      if (event.hasMore) return { state: { ...next }, effects: [{ kind: 'pull' }] };
      if (next.wakePending) return beginCycle(next);
      return rest(next);
    }

    case 'failed': {
      const next = { ...state, lastError: event.message };
      switch (event.kind) {
        case 'reauth':
          return { state: { ...next, status: 'reauth_required' }, effects: [] };
        case 'fatal':
          return { state: { ...next, status: 'fatal' }, effects: [] };
        case 'quota':
          return { state: { ...next, status: 'paused_quota' }, effects: [] };
        case 'retryable': {
          if (!next.online) {
            return { state: { ...next, status: 'offline', attempts: 0 }, effects: [] };
          }
          const attempts = next.attempts + 1;
          return {
            state: { ...next, status: 'backoff', attempts },
            effects: [{ kind: 'schedule_backoff', delayMs: backoffDelay(attempts) }],
          };
        }
      }
    }

    case 'backoff_elapsed':
      if (state.status !== 'backoff') return { state, effects: [] };
      return beginCycle(state);

    case 'quota_cleared':
      if (state.status !== 'paused_quota') return { state, effects: [] };
      return beginCycle({ ...state, lastError: null });
  }
}

/** Runs a list of events through the reducer, which is what the tests read as. */
export function run(state: SyncState, events: SyncEvent[]): Transition {
  let current = state;
  let effects: Effect[] = [];
  for (const event of events) {
    const next = reduce(current, event);
    current = next.state;
    effects = next.effects;
  }
  return { state: current, effects };
}
