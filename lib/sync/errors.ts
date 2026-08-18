/**
 * What kind of failure this was, which is the only thing the state machine
 * needs to know about an error.
 *
 * The classification matters more than it looks. Treating a 401 as retryable
 * means an expired session backs off forever while the outbox grows and the
 * user is told "syncing". Treating a 500 as fatal means one bad deploy
 * permanently bricks a client that would have recovered on its own. So the
 * mapping lives here, in one table, rather than being re-derived at each call
 * site.
 */

export type FailureKind = 'retryable' | 'reauth' | 'quota' | 'fatal';

export interface SyncFailure {
  kind: FailureKind;
  code: string;
  message: string;
  status?: number;
}

/** Postgres SQLSTATEs the RPCs raise on purpose. */
const NOT_AUTHENTICATED = '28000';
const INVALID_PARAMETER = '22023';
const INSUFFICIENT_PRIVILEGE = '42501';
/** Two devices generated the same occurrence. The loser accepts the server's. */
export const UNIQUE_VIOLATION = '23505';

export function classifyStatus(status: number): FailureKind {
  if (status === 401 || status === 403) return 'reauth';
  if (status === 413 || status === 422 || status === 400) return 'fatal';
  if (status === 429) return 'retryable';
  if (status >= 500) return 'retryable';
  return 'fatal';
}

export function classifyPostgres(code: string): FailureKind {
  switch (code) {
    case NOT_AUTHENTICATED:
      return 'reauth';
    case INVALID_PARAMETER:
    case INSUFFICIENT_PRIVILEGE:
      return 'fatal';
    case UNIQUE_VIOLATION:
      // Not an error the client should retry or surface. The push handler
      // resolves it by discarding the local row and taking the server's.
      return 'fatal';
    default:
      // Deadlocks, serialization failures and lock timeouts all start 40, and
      // every one of them is worth trying again.
      return code.startsWith('40') ? 'retryable' : 'fatal';
  }
}

/**
 * A thrown value turned into a failure. Anything that is not recognisably an
 * HTTP or Postgres error is treated as retryable, because the common cause is
 * the network vanishing mid-request and that always deserves another go.
 */
export function classify(error: unknown): SyncFailure {
  if (error instanceof TypeError) {
    // fetch rejects with a TypeError when the network is unreachable, which is
    // the single most common failure in an offline-first app.
    return { kind: 'retryable', code: 'network', message: error.message };
  }

  if (typeof error === 'object' && error !== null) {
    const e = error as { status?: number; code?: string; message?: string };

    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return {
        kind: classifyPostgres(e.code),
        code: e.code,
        message: e.message ?? 'database error',
        ...(e.status !== undefined ? { status: e.status } : {}),
      };
    }

    if (e.code === 'QuotaExceededError' || e.message?.includes('QuotaExceeded')) {
      return { kind: 'quota', code: 'quota', message: e.message ?? 'storage full' };
    }

    if (typeof e.status === 'number') {
      return {
        kind: classifyStatus(e.status),
        code: String(e.status),
        message: e.message ?? 'request failed',
        status: e.status,
      };
    }
  }

  return {
    kind: 'retryable',
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  };
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 60_000;

/**
 * Capped exponential, and deliberately without jitter.
 *
 * Jitter exists to stop a herd of clients retrying in lockstep. Exactly one tab
 * per user holds the sync lock, so there is no herd to spread out, and a
 * deterministic delay is one less thing the machine tests have to stub.
 */
export function backoffDelay(attempts: number): number {
  const step = Math.max(1, attempts);
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (step - 1));
}
