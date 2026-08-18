import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReminderKind } from './types';
import { appUrl, requireEnv } from './env';

/**
 * The unsubscribe link, signed.
 *
 * An HMAC over a small JSON payload rather than a JWT: the only reader is this
 * app, there is no key rotation to coordinate and no third party to interoperate
 * with, so a library would add a dependency and nothing else.
 *
 * Never a raw user id in the URL. The token carries the address it was minted
 * for, the setting it turns off, and the token version from user_settings, which
 * is what makes revocation possible: bump that integer and every link already
 * sitting in an inbox stops working.
 */
export interface UnsubscribeClaims {
  /** The address the link was minted for. */
  email: string;
  /** Which setting the link turns off. */
  kind: ReminderKind | 'all';
  /** user_settings.email_token_version at mint time. */
  version: number;
}

const PURPOSE = 'tend.unsubscribe.v1';

function secret(): string {
  return requireEnv('EMAIL_TOKEN_SECRET');
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(`${PURPOSE}.${body}`).digest('base64url');
}

export function mintUnsubscribeToken(claims: UnsubscribeClaims): string {
  const body = encode(claims);
  return `${body}.${sign(body)}`;
}

/** The claims, or null for anything tampered with. Never throws on bad input. */
export function readUnsubscribeToken(token: string): UnsubscribeClaims | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as UnsubscribeClaims;
    if (typeof claims.email !== 'string' || typeof claims.version !== 'number') return null;
    return claims;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(claims: UnsubscribeClaims): string {
  return `${appUrl()}/api/email/unsubscribe?t=${mintUnsubscribeToken(claims)}`;
}
