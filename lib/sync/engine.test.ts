// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wiring between the machine and its effects.
 *
 * The reducer has its own suite and all of it passed while sync was completely
 * broken, because the bug was not in any transition: it was in the engine
 * clearing its in-flight guard one tick too late, so the effect each settled
 * event produced dropped itself and the cycle died one step in. Nothing pure
 * could catch that. These tests drive the real engine with fake transport and
 * assert that a cycle actually finishes.
 */

const pushOnce = vi.fn();
const pullOnce = vi.fn();
const readCursor = vi.fn(async () => 0);

vi.mock('@/lib/db/client', () => ({
  openDb: vi.fn(async () => ({ outbox: {} })),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  }),
}));

vi.mock('./push', () => ({ pushOnce: (...args: unknown[]) => pushOnce(...args) }));
vi.mock('./pull', () => ({ pullOnce: (...args: unknown[]) => pullOnce(...args) }));
vi.mock('./apply', () => ({ readCursor: () => readCursor() }));
vi.mock('./outbox', () => ({ reclaimStale: vi.fn(async () => 0) }));
vi.mock('./triggers', () => ({ installTriggers: () => () => {} }));
vi.mock('./leader', () => ({
  electLeader: (onAcquired: () => void) => {
    onAcquired();
    return { release: () => {} };
  },
}));

const { SyncEngine } = await import('./engine');
const { SyncError } = await import('./transport');

function engine() {
  return new SyncEngine();
}

beforeEach(() => {
  pushOnce.mockReset();
  pullOnce.mockReset();
  readCursor.mockReset();
  readCursor.mockResolvedValue(0);
});

describe('a full cycle', () => {
  it('reaches idle instead of stalling after the push', async () => {
    // The regression. Before the fix this sat in hydrating forever: the pull
    // effect that push_settled produced saw the in-flight guard still up and
    // silently returned, leaving no pending work and no error.
    pushOnce.mockResolvedValue({ cursor: 0, sent: false, hasMore: false, merged: 0 });
    pullOnce.mockResolvedValue({ cursor: 12, hasMore: false, applied: 3, skipped: 0 });

    const sync = engine();
    sync.start();

    await vi.waitFor(() => expect(sync.getState().status).toBe('idle'));
    expect(pushOnce).toHaveBeenCalledTimes(1);
    expect(pullOnce).toHaveBeenCalledTimes(1);
    expect(sync.getState().cursor).toBe(12);
  });

  it('pushes before it pulls', async () => {
    const order: string[] = [];
    pushOnce.mockImplementation(async () => {
      order.push('push');
      return { cursor: 0, sent: true, hasMore: false, merged: 0 };
    });
    pullOnce.mockImplementation(async () => {
      order.push('pull');
      return { cursor: 5, hasMore: false, applied: 0, skipped: 0 };
    });

    const sync = engine();
    sync.start();

    await vi.waitFor(() => expect(sync.getState().status).toBe('idle'));
    expect(order).toEqual(['push', 'pull']);
  });

  it('keeps paging until the server runs out', async () => {
    pushOnce.mockResolvedValue({ cursor: 0, sent: false, hasMore: false, merged: 0 });
    pullOnce
      .mockResolvedValueOnce({ cursor: 100, hasMore: true, applied: 500, skipped: 0 })
      .mockResolvedValueOnce({ cursor: 200, hasMore: true, applied: 500, skipped: 0 })
      .mockResolvedValueOnce({ cursor: 250, hasMore: false, applied: 50, skipped: 0 });

    const sync = engine();
    sync.start();

    await vi.waitFor(() => expect(sync.getState().status).toBe('idle'));
    expect(pullOnce).toHaveBeenCalledTimes(3);
    expect(sync.getState().cursor).toBe(250);
  });

  it('runs another cycle for a trigger that arrived mid-flight', async () => {
    pushOnce.mockResolvedValue({ cursor: 0, sent: false, hasMore: false, merged: 0 });
    pullOnce.mockResolvedValue({ cursor: 1, hasMore: false, applied: 0, skipped: 0 });

    const sync = engine();
    sync.start();
    await vi.waitFor(() => expect(sync.getState().status).toBe('idle'));

    sync.dispatch({ type: 'wake' });
    await vi.waitFor(() => expect(pushOnce).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(sync.getState().status).toBe('idle'));
  });
});

describe('failures', () => {
  it('backs off rather than stalling when a push fails', async () => {
    pushOnce.mockRejectedValue(
      new SyncError({ kind: 'retryable', code: '500', message: 'server' }),
    );

    const sync = engine();
    sync.start();

    await vi.waitFor(() => expect(sync.getState().status).toBe('backoff'));
    expect(sync.getState().attempts).toBe(1);
    expect(pullOnce).not.toHaveBeenCalled();
  });

  it('stops for a reauth instead of retrying a dead session', async () => {
    pushOnce.mockResolvedValue({ cursor: 0, sent: false, hasMore: false, merged: 0 });
    pullOnce.mockRejectedValue(
      new SyncError({ kind: 'reauth', code: '401', message: 'not authenticated' }),
    );

    const sync = engine();
    sync.start();

    await vi.waitFor(() => expect(sync.getState().status).toBe('reauth_required'));
    expect(sync.getState().lastError).toBe('not authenticated');
  });

  it('recovers on the next cycle after a failure', async () => {
    pushOnce
      .mockRejectedValueOnce(
        new SyncError({ kind: 'retryable', code: '500', message: 'server' }),
      )
      .mockResolvedValue({ cursor: 0, sent: false, hasMore: false, merged: 0 });
    pullOnce.mockResolvedValue({ cursor: 9, hasMore: false, applied: 1, skipped: 0 });

    const sync = engine();
    sync.start();
    await vi.waitFor(() => expect(sync.getState().status).toBe('backoff'));

    // A trigger cuts the backoff short, which is what tapping something does.
    sync.dispatch({ type: 'wake' });
    await vi.waitFor(() => expect(sync.getState().status).toBe('idle'));
    expect(sync.getState().attempts).toBe(0);
  });
});

describe('without a session', () => {
  it('comes to rest signed out and sends nothing', async () => {
    vi.doMock('@/lib/supabase/client', () => ({
      getSupabase: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
      }),
    }));
    vi.resetModules();
    const { SyncEngine: Fresh } = await import('./engine');

    const sync = new Fresh();
    sync.start();

    await vi.waitFor(() => expect(sync.getState().status).toBe('no_session'));
    expect(pushOnce).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/supabase/client');
  });
});
