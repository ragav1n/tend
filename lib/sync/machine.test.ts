import { describe, expect, it } from 'vitest';
import { backoffDelay, BACKOFF_CAP_MS, classify, classifyStatus } from './errors';
import { initialState, isBusy, reduce, run, type SyncEvent, type SyncState } from './machine';

/** The state a healthy signed-in leader tab sits in, ready to sync. */
function ready(over: Partial<SyncState> = {}): SyncState {
  return {
    ...initialState,
    status: 'idle',
    dbOpen: true,
    session: true,
    leader: true,
    online: true,
    cursor: 42,
    ...over,
  };
}

const BOOT: SyncEvent[] = [{ type: 'started' }, { type: 'db_opened' }];

describe('booting', () => {
  it('opens the database before anything else', () => {
    const { state, effects } = reduce(initialState, { type: 'started' });
    expect(state.status).toBe('opening_db');
    expect(effects).toEqual([{ kind: 'open_db' }]);
  });

  it('asks for a session and the lock once the database is open', () => {
    const { effects } = run(initialState, BOOT);
    expect(effects).toEqual([{ kind: 'check_session' }, { kind: 'acquire_leader' }]);
  });

  it('treats a database that will not open as fatal', () => {
    const { state } = run(initialState, [...BOOT.slice(0, 1), { type: 'db_failed', message: 'x' }]);
    expect(state.status).toBe('fatal');
  });

  it('rests in no_session when signed out, rather than erroring', () => {
    // The app is fully usable signed out. It reads and it queues.
    const { state } = run(initialState, [...BOOT, { type: 'session_lost' }]);
    expect(state.status).toBe('no_session');
  });

  it('rests in follower when another tab holds the lock', () => {
    const { state } = run(initialState, [
      ...BOOT,
      { type: 'session_found', cursor: 0 },
      { type: 'leader_lost' },
    ]);
    expect(state.status).toBe('follower');
  });
});

describe('the cycle', () => {
  it('pushes before it pulls', () => {
    // Pulling first would apply a server row over a local edit that has not
    // been sent, and the local edit would be gone with nothing left to resend.
    const { state, effects } = reduce(ready(), { type: 'wake' });
    expect(state.status).toBe('pushing');
    expect(effects).toEqual([{ kind: 'push' }]);
  });

  it('pulls once the push lands', () => {
    const pushed = reduce(ready({ status: 'pushing' }), { type: 'push_settled', cursor: 50 });
    expect(pushed.state.status).toBe('pulling');
    expect(pushed.state.cursor).toBe(50);
    expect(pushed.effects).toEqual([{ kind: 'pull' }]);
  });

  it('keeps paging inside the cycle while the server has more', () => {
    const paging = reduce(ready({ status: 'pulling' }), {
      type: 'pull_settled',
      cursor: 60,
      hasMore: true,
    });
    expect(paging.state.status).toBe('pulling');
    expect(paging.effects).toEqual([{ kind: 'pull' }]);
  });

  it('comes to rest when the last page lands', () => {
    const done = reduce(ready({ status: 'pulling' }), {
      type: 'pull_settled',
      cursor: 60,
      hasMore: false,
    });
    expect(done.state.status).toBe('idle');
    expect(done.effects).toEqual([]);
  });

  it('calls the first cycle hydrating, since the cursor is still zero', () => {
    const first = reduce(ready({ cursor: 0 }), { type: 'wake' });
    expect(first.state.status).toBe('hydrating');
    // And stays hydrating through the pull, so the badge does not flicker
    // between two words during the initial load.
    const pulling = reduce(first.state, { type: 'push_settled', cursor: 0 });
    expect(pulling.state.status).toBe('hydrating');
  });

  it('syncs the moment a session appears, without waiting for a trigger', () => {
    const { state, effects } = run(initialState, [
      ...BOOT,
      { type: 'leader_acquired' },
      { type: 'session_found', cursor: 7 },
    ]);
    expect(state.status).toBe('pushing');
    expect(effects).toEqual([{ kind: 'push' }]);
  });

  it('never lets the cursor go backwards', () => {
    // A late response from an abandoned cycle must not rewind progress, or the
    // next pull re-applies rows that were already applied.
    const { state } = reduce(ready({ status: 'pulling', cursor: 90 }), {
      type: 'pull_settled',
      cursor: 30,
      hasMore: false,
    });
    expect(state.cursor).toBe(90);
  });
});

describe('triggers', () => {
  it('coalesces triggers that arrive mid-cycle into one extra cycle', () => {
    let state = ready({ status: 'pushing' });
    for (let i = 0; i < 10; i++) state = reduce(state, { type: 'wake' }).state;
    expect(state.wakePending).toBe(true);

    const settled = reduce(state, { type: 'push_settled', cursor: 50 });
    const done = reduce(settled.state, { type: 'pull_settled', cursor: 50, hasMore: false });
    // Ten triggers, one extra cycle.
    expect(done.state.status).toBe('pushing');
    expect(done.state.wakePending).toBe(false);
  });

  it('lets a trigger cut a backoff short', () => {
    // Someone tapping something beats waiting out an exponential delay.
    const { state, effects } = reduce(ready({ status: 'backoff', attempts: 4 }), { type: 'wake' });
    expect(state.status).toBe('pushing');
    expect(state.attempts).toBe(0);
    expect(effects).toEqual([{ kind: 'cancel_backoff' }, { kind: 'push' }]);
  });

  it('remembers a trigger that arrived while it could not act on it', () => {
    const offline = reduce(ready({ online: false, status: 'offline' }), { type: 'wake' });
    expect(offline.state.status).toBe('offline');
    expect(offline.state.wakePending).toBe(true);

    const back = reduce(offline.state, { type: 'network_online' });
    expect(back.state.status).toBe('pushing');
  });

  it('ignores triggers once halted', () => {
    for (const status of ['reauth_required', 'fatal', 'paused_quota'] as const) {
      const { state, effects } = reduce(ready({ status }), { type: 'wake' });
      expect(state.status).toBe(status);
      expect(effects).toEqual([]);
    }
  });
});

describe('failure handling', () => {
  it('backs off on a retryable failure and grows the delay', () => {
    let state = ready({ status: 'pushing' });
    const delays: number[] = [];

    for (let i = 0; i < 4; i++) {
      const failed = reduce(state, { type: 'failed', kind: 'retryable', message: 'boom' });
      delays.push((failed.effects[0] as { delayMs: number }).delayMs);
      state = reduce(failed.state, { type: 'backoff_elapsed' }).state;
      state = { ...state, status: 'pushing' };
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('caps the backoff', () => {
    expect(backoffDelay(99)).toBe(BACKOFF_CAP_MS);
  });

  it('resets the attempt count after a success', () => {
    const failed = reduce(ready({ status: 'pushing' }), {
      type: 'failed',
      kind: 'retryable',
      message: 'boom',
    });
    expect(failed.state.attempts).toBe(1);

    const retried = reduce(failed.state, { type: 'backoff_elapsed' });
    const ok = reduce(retried.state, { type: 'push_settled', cursor: 50 });
    expect(ok.state.attempts).toBe(0);
  });

  it('goes offline rather than backing off when the network is already gone', () => {
    // Backing off while offline burns attempts on a network that cannot answer,
    // so the delay is at its cap by the time it comes back.
    const { state, effects } = reduce(ready({ status: 'pushing', online: false }), {
      type: 'failed',
      kind: 'retryable',
      message: 'offline',
    });
    expect(state.status).toBe('offline');
    expect(state.attempts).toBe(0);
    expect(effects).toEqual([]);
  });

  it('stops for a reauth without touching anything else', () => {
    const { state } = reduce(ready({ status: 'pulling' }), {
      type: 'failed',
      kind: 'reauth',
      message: 'expired',
    });
    expect(state.status).toBe('reauth_required');
    // Still leader, still has a cursor. The app keeps working.
    expect(state.leader).toBe(true);
    expect(state.cursor).toBe(42);
  });

  it('waits out a quota failure until storage is freed', () => {
    const full = reduce(ready({ status: 'pulling' }), {
      type: 'failed',
      kind: 'quota',
      message: 'full',
    });
    expect(full.state.status).toBe('paused_quota');

    const freed = reduce(full.state, { type: 'quota_cleared' });
    expect(freed.state.status).toBe('pushing');
  });

  it('cancels a pending backoff when the network drops', () => {
    const { state, effects } = reduce(ready({ status: 'backoff', attempts: 3 }), {
      type: 'network_offline',
    });
    expect(state.status).toBe('offline');
    expect(state.attempts).toBe(0);
    expect(effects).toEqual([{ kind: 'cancel_backoff' }]);
  });
});

describe('interleavings that would otherwise need a mocked network', () => {
  it('abandons an in-flight cycle when the lock is lost', () => {
    const lost = reduce(ready({ status: 'pushing' }), { type: 'leader_lost' });
    expect(lost.state.status).toBe('follower');

    // The response that was already in flight must not restart the cycle.
    const late = reduce(lost.state, { type: 'push_settled', cursor: 90 });
    expect(late.state.status).toBe('follower');
    expect(late.effects).toEqual([]);
  });

  it('drops a late pull response that arrives after a session ends', () => {
    const out = reduce(ready({ status: 'pulling' }), { type: 'session_lost' });
    const late = reduce(out.state, { type: 'pull_settled', cursor: 99, hasMore: true });
    expect(late.state.status).toBe('no_session');
    expect(late.effects).toEqual([]);
  });

  it('keeps the outbox when a session ends', () => {
    // Nothing in the machine clears queued work, ever. This asserts the
    // absence, which is the whole point of REAUTH_REQUIRED existing.
    const events: SyncEvent[] = [{ type: 'session_lost' }, { type: 'leader_lost' }];
    for (const event of events) {
      const { effects } = reduce(ready({ status: 'pushing' }), event);
      expect(effects).toEqual([]);
    }
  });

  it('resumes as leader when another tab closes', () => {
    const follower = reduce(ready({ status: 'pushing' }), { type: 'leader_lost' });
    const woken = reduce(follower.state, { type: 'wake' });
    expect(woken.state.wakePending).toBe(true);

    const promoted = reduce(woken.state, { type: 'leader_acquired' });
    expect(promoted.state.status).toBe('pushing');
  });
});

describe('error classification', () => {
  it.each([
    [401, 'reauth'],
    [403, 'reauth'],
    [429, 'retryable'],
    [500, 'retryable'],
    [503, 'retryable'],
    [400, 'fatal'],
    [413, 'fatal'],
  ])('maps HTTP %i to %s', (status, kind) => {
    expect(classifyStatus(status)).toBe(kind);
  });

  it('treats a failed fetch as retryable', () => {
    // fetch rejects with a TypeError when the network is unreachable, which is
    // the most common failure an offline-first app sees.
    expect(classify(new TypeError('Failed to fetch')).kind).toBe('retryable');
  });

  it('reads a Postgres not-authenticated as a reauth', () => {
    expect(classify({ code: '28000', message: 'not authenticated' }).kind).toBe('reauth');
  });

  it('retries a serialization failure', () => {
    expect(classify({ code: '40001', message: 'could not serialize' }).kind).toBe('retryable');
  });

  it('does not retry the duplicate-occurrence race', () => {
    // Two devices generated the same occurrence. Retrying re-loses the same
    // race; the resolution is to take the server's row.
    expect(classify({ code: '23505', message: 'duplicate key' }).kind).toBe('fatal');
  });
});

describe('isBusy', () => {
  it('covers exactly the statuses with a request in flight', () => {
    expect((['pushing', 'pulling', 'hydrating'] as const).every(isBusy)).toBe(true);
    expect(
      (['idle', 'offline', 'backoff', 'follower', 'no_session'] as const).some(isBusy),
    ).toBe(false);
  });
});
