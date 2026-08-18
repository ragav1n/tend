import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintUnsubscribeToken, readUnsubscribeToken, unsubscribeUrl } from './unsubscribe';

/**
 * The unsubscribe token.
 *
 * Signed rather than opaque, because the route that reads it has no session to
 * check: a one-click unsubscribe arrives from the mail provider with no cookies.
 * The token is the whole authorization, so tampering has to fail closed.
 */

beforeEach(() => {
  vi.stubEnv('EMAIL_TOKEN_SECRET', 'a-long-random-string');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tend.example.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('round trip', () => {
  it('reads back what it minted', () => {
    const claims = { email: 'me@example.com', kind: 'daily_digest' as const, version: 3 };
    expect(readUnsubscribeToken(mintUnsubscribeToken(claims))).toEqual(claims);
  });

  it('puts no user id in the URL', () => {
    const url = unsubscribeUrl({ email: 'me@example.com', kind: 'all', version: 1 });
    expect(url.startsWith('https://tend.example.com/api/email/unsubscribe?t=')).toBe(true);
  });
});

describe('tampering', () => {
  const claims = { email: 'me@example.com', kind: 'all' as const, version: 1 };

  it('rejects an edited payload', () => {
    const [, signature] = mintUnsubscribeToken(claims).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claims, email: 'someone@else.com' }),
      'utf8',
    ).toString('base64url');

    expect(readUnsubscribeToken(`${forged}.${signature}`)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const token = mintUnsubscribeToken(claims);
    vi.stubEnv('EMAIL_TOKEN_SECRET', 'a-different-string');
    expect(readUnsubscribeToken(token)).toBeNull();
  });

  it('returns null rather than throwing on rubbish', () => {
    for (const value of ['', '.', 'nope', 'a.b.c', '!!!.!!!']) {
      expect(readUnsubscribeToken(value)).toBeNull();
    }
  });
});
