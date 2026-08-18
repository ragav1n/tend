import { classify, type SyncFailure } from './errors';

/**
 * One fetch helper for both sync routes, so a failure is classified in exactly
 * one place.
 *
 * The thrown value is always a SyncFailure. The machine's only question about
 * an error is which of four kinds it is, and deciding that at the call site
 * meant `push.ts` and `pull.ts` each getting it subtly differently.
 */
export class SyncError extends Error {
  readonly failure: SyncFailure;

  constructor(failure: SyncFailure) {
    super(failure.message);
    this.name = 'SyncError';
    this.failure = failure;
  }
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // The session lives in a cookie the proxy keeps fresh.
      credentials: 'same-origin',
      // Belt and braces against any intermediary caching a sync response.
      cache: 'no-store',
    });
  } catch (error) {
    // fetch rejects rather than resolving when the network is unreachable,
    // which is the single most common failure an offline-first app sees.
    throw new SyncError(classify(error));
  }

  if (!response.ok) {
    let detail: { error?: string; code?: string } = {};
    try {
      detail = (await response.json()) as typeof detail;
    } catch {
      // A gateway returning HTML is still a status worth classifying.
    }
    throw new SyncError(
      classify({
        status: response.status,
        code: detail.code,
        message: detail.error ?? `${response.status} ${response.statusText}`,
      }),
    );
  }

  return (await response.json()) as T;
}
