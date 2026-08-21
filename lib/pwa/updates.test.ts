import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpdateManager, type UpdateEnvironment, type UpdateManager } from './updates';

/**
 * The handover, driven by hand.
 *
 * None of this can be exercised through a real browser in a unit test, and the
 * part that goes wrong is the order: a reload issued before the new worker is in
 * charge is served the old precache and comes back on the same version. So the
 * fakes model exactly the sequence the spec defines and the tests assert when
 * the reload happens, not just that it does.
 */

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installed';
  posted: unknown[] = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  moveTo(next: ServiceWorkerState): void {
    this.state = next;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  updates = 0;
  /** What `update()` finds, if anything. */
  onUpdate: (() => void) | null = null;

  update(): Promise<void> {
    this.updates += 1;
    this.onUpdate?.();
    return Promise.resolve();
  }
}

class FakeContainer extends EventTarget {
  controller: object | null = {};
}

interface Harness {
  manager: UpdateManager;
  registration: FakeRegistration;
  container: FakeContainer;
  reloads: () => number;
  cleared: () => number;
  store: Map<string, string>;
  /** What the deployment answers with. Writable, so a test can land a deploy. */
  deployed: { version: string | null };
}

function harness(
  options: {
    version?: string;
    latest?: string | null;
    store?: Map<string, string>;
    container?: boolean;
  } = {},
): Harness {
  const registration = new FakeRegistration();
  const container = new FakeContainer();
  const store = options.store ?? new Map<string, string>();
  const deployed = { version: options.latest === undefined ? '1.0.0' : options.latest };
  let reloads = 0;
  let cleared = 0;

  const env: UpdateEnvironment = {
    version: options.version ?? '1.0.0',
    container:
      options.container === false ? null : (container as unknown as ServiceWorkerContainer),
    register: () =>
      Promise.resolve(
        options.container === false
          ? null
          : (registration as unknown as ServiceWorkerRegistration),
      ),
    fetchLatest: () => Promise.resolve(deployed.version),
    reload: () => {
      reloads += 1;
    },
    session: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
    clearPageCaches: () => {
      cleared += 1;
      return Promise.resolve();
    },
  };

  return {
    manager: createUpdateManager(env),
    registration,
    container,
    reloads: () => reloads,
    cleared: () => cleared,
    store,
    deployed,
  };
}

/** Enough turns to drain the resolved-promise chains `start` and `check` set up. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('what the tab is running', () => {
  it('says it is current when the deployment agrees and nothing is waiting', async () => {
    const h = harness();
    h.manager.start();
    await flush();

    expect(h.manager.getState()).toMatchObject({ status: 'current', latest: '1.0.0' });
  });

  it('notices a newer deployment with no worker involved', async () => {
    const h = harness({ latest: '1.1.0' });
    h.manager.start();
    await flush();

    expect(h.manager.getState().status).toBe('available');
  });

  it('notices a waiting worker even when the versions match', async () => {
    const h = harness();
    h.registration.waiting = new FakeWorker();
    h.manager.start();
    await flush();

    expect(h.manager.getState().status).toBe('available');
  });

  it('notices a worker that installs while the tab is open', async () => {
    const h = harness();
    h.manager.start();
    await flush();
    expect(h.manager.getState().status).toBe('current');

    const worker = new FakeWorker();
    worker.state = 'installing';
    h.registration.installing = worker;
    h.registration.dispatchEvent(new Event('updatefound'));
    worker.moveTo('installed');
    await flush();

    expect(h.manager.getState().status).toBe('available');
  });

  it('asks what version it is before announcing a worker it found alone', async () => {
    const h = harness({ latest: '1.0.0' });
    h.manager.start();
    await flush();
    expect(h.manager.getState().status).toBe('current');

    // A deploy lands, and the browser's own update finds it long before the
    // hourly check would. Announcing on the worker alone here would offer
    // "Version 1.0.0" to a tab already running 1.0.0.
    h.deployed.version = '1.1.0';
    const worker = new FakeWorker();
    worker.state = 'installing';
    h.registration.installing = worker;
    h.registration.dispatchEvent(new Event('updatefound'));
    worker.moveTo('installed');

    expect(h.manager.getState().status).toBe('checking');
    await flush();
    expect(h.manager.getState()).toMatchObject({ status: 'available', latest: '1.1.0' });
  });

  it('still announces when the version it asked for never came back', async () => {
    const h = harness({ latest: '1.0.0' });
    h.manager.start();
    await flush();

    h.deployed.version = null;
    const worker = new FakeWorker();
    worker.state = 'installing';
    h.registration.installing = worker;
    h.registration.dispatchEvent(new Event('updatefound'));
    worker.moveTo('installed');
    await flush();

    expect(h.manager.getState().status).toBe('available');
  });

  it('does not sit on checking when there is no worker and no network', async () => {
    const h = harness({ container: false, latest: null });
    h.manager.start();
    await flush();

    // Nothing to register and nothing answered, so neither of the old exits
    // existed and the button in settings stayed disabled for good.
    expect(h.manager.getState()).toMatchObject({ status: 'current', offline: true });
  });

  it('gives the tab its controls back when a reload does not happen', async () => {
    const h = harness();
    h.registration.waiting = new FakeWorker();
    h.manager.start();
    await flush();

    void h.manager.apply();
    await flush();
    h.container.dispatchEvent(new Event('controllerchange'));
    expect(h.manager.getState().status).toBe('applying');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.manager.getState().status).not.toBe('applying');
  });

  it('does not call a first install an update', async () => {
    const h = harness();
    h.container.controller = null;
    h.manager.start();
    await flush();

    const worker = new FakeWorker();
    worker.state = 'installing';
    h.registration.installing = worker;
    h.registration.dispatchEvent(new Event('updatefound'));
    worker.moveTo('installed');

    expect(h.manager.getState().status).toBe('current');
  });

  it('keeps the last answer when a check cannot reach the server', async () => {
    const h = harness({ latest: null });
    h.manager.start();
    await flush();

    expect(h.manager.getState()).toMatchObject({ offline: true, latest: null });
  });

  it('works with no service worker at all', async () => {
    const h = harness({ container: false, latest: '1.1.0' });
    h.manager.start();
    await flush();

    expect(h.manager.getState().status).toBe('available');
  });

  it('checks again when the backstop timer fires', async () => {
    const h = harness();
    h.manager.start();
    await flush();
    expect(h.registration.updates).toBe(1);

    // The regression this guards: an interval set to the same value as the
    // throttle loses the race with it and drops every other tick.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(h.registration.updates).toBe(2);
  });

  it('retries sooner after a check that never landed', async () => {
    const h = harness({ latest: null });
    h.manager.start();
    await flush();
    expect(h.registration.updates).toBe(1);

    await h.manager.check();
    expect(h.registration.updates).toBe(1);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await h.manager.check();
    expect(h.registration.updates).toBe(2);
  });

  it('throttles an automatic check and honours a forced one', async () => {
    const h = harness();
    h.manager.start();
    await flush();
    expect(h.registration.updates).toBe(1);

    await h.manager.check();
    expect(h.registration.updates).toBe(1);

    await h.manager.check({ force: true });
    expect(h.registration.updates).toBe(2);
  });
});

describe('applying it', () => {
  it('waits for the worker to take over before reloading', async () => {
    const h = harness();
    const worker = new FakeWorker();
    h.registration.waiting = worker;
    h.manager.start();
    await flush();

    void h.manager.apply();
    await flush();

    expect(worker.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    // The whole point. A reload here is served the old precache.
    expect(h.reloads()).toBe(0);
    expect(h.manager.getState().status).toBe('applying');

    worker.moveTo('activated');
    expect(h.reloads()).toBe(1);
  });

  it('reloads as soon as the controller changes', async () => {
    const h = harness();
    h.registration.waiting = new FakeWorker();
    h.manager.start();
    await flush();

    void h.manager.apply();
    await flush();
    h.container.dispatchEvent(new Event('controllerchange'));

    expect(h.reloads()).toBe(1);
  });

  it('reloads once, however many signals arrive', async () => {
    const h = harness();
    const worker = new FakeWorker();
    h.registration.waiting = worker;
    h.manager.start();
    await flush();

    void h.manager.apply();
    await flush();
    h.container.dispatchEvent(new Event('controllerchange'));
    worker.moveTo('activated');
    await vi.advanceTimersByTimeAsync(20_000);

    expect(h.reloads()).toBe(1);
  });

  it('reloads anyway when the handover never happens', async () => {
    const h = harness();
    h.registration.waiting = new FakeWorker();
    h.manager.start();
    await flush();

    void h.manager.apply();
    await flush();
    expect(h.reloads()).toBe(0);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.reloads()).toBe(1);
  });

  it('asks for a worker when only the deployment said there was one', async () => {
    const h = harness({ latest: '1.1.0' });
    h.manager.start();
    await flush();

    const worker = new FakeWorker();
    h.registration.onUpdate = () => {
      h.registration.waiting = worker;
    };

    void h.manager.apply();
    await flush();

    expect(worker.posted).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('reloads plainly when no worker ever appears', async () => {
    const h = harness({ latest: '1.1.0' });
    h.manager.start();
    await flush();

    void h.manager.apply();
    await vi.advanceTimersByTimeAsync(4_000);

    expect(h.reloads()).toBe(1);
  });

  it('reloads when another tab swaps the worker under it', async () => {
    const h = harness();
    h.manager.start();
    await flush();

    h.container.dispatchEvent(new Event('controllerchange'));
    expect(h.reloads()).toBe(1);
  });

  it('does not reload on the controller a first install installs', async () => {
    const h = harness();
    h.container.controller = null;
    h.manager.start();
    await flush();

    h.container.dispatchEvent(new Event('controllerchange'));
    expect(h.reloads()).toBe(0);
  });
});

describe('an update that did not take', () => {
  it('comes back as failed, and clears the page caches on the next try', async () => {
    const store = new Map<string, string>();

    const first = harness({ store, latest: '1.1.0' });
    first.registration.waiting = new FakeWorker();
    first.manager.start();
    await flush();
    void first.manager.apply();
    await flush();
    expect(first.cleared()).toBe(0);

    // The tab comes back on the same version it tried to leave.
    const second = harness({ store, latest: '1.1.0' });
    second.registration.waiting = new FakeWorker();
    second.manager.start();
    await flush();

    expect(second.manager.getState().status).toBe('failed');

    void second.manager.apply();
    await flush();
    expect(second.cleared()).toBe(1);
  });

  it('remembers a failed attempt that left no worker behind', async () => {
    const store = new Map<string, string>();

    // The deployment reports another version and nothing installs a worker for
    // it, so `apply` can only reload. This is the case the cache escalation
    // was written for, and the one a settle before the first check used to
    // forget on the way back in.
    const first = harness({ store, latest: '1.1.0' });
    first.manager.start();
    await flush();
    void first.manager.apply();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(first.reloads()).toBe(1);

    const second = harness({ store, latest: '1.1.0' });
    second.manager.start();
    await flush();
    expect(second.manager.getState().status).toBe('failed');

    void second.manager.apply();
    await flush();
    expect(second.cleared()).toBe(1);
  });

  it('forgets the attempt once the version actually moves', async () => {
    const store = new Map<string, string>();

    const first = harness({ store, version: '1.0.0', latest: '1.1.0' });
    first.registration.waiting = new FakeWorker();
    first.manager.start();
    await flush();
    void first.manager.apply();
    await flush();

    const second = harness({ store, version: '1.1.0', latest: '1.1.0' });
    second.manager.start();
    await flush();

    expect(second.manager.getState().status).toBe('current');
    expect(store.size).toBe(0);
  });

  it('leaves the attempt alone when the build carries no version', async () => {
    const store = new Map<string, string>();
    const h = harness({ store, version: '', latest: '1.1.0' });
    h.registration.waiting = new FakeWorker();
    h.manager.start();
    await flush();

    void h.manager.apply();
    await flush();

    expect(store.size).toBe(0);
  });
});
