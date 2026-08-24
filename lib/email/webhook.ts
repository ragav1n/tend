import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Svix signature verification, which is what Resend signs webhooks with.
 *
 * Written out rather than pulled in as a dependency: it is an HMAC over three
 * concatenated values, and the whole implementation is shorter than the lockfile
 * entry would be.
 *
 * The signature covers the raw body, so it has to be verified before anything
 * parses that body. Parsing first and checking after means an attacker's JSON has
 * already been through the parser, which is the part that has the CVEs.
 */

/** Five minutes, matching Svix's own tolerance. */
export const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function readSvixHeaders(headers: Headers): SvixHeaders {
  return {
    id: headers.get('svix-id'),
    timestamp: headers.get('svix-timestamp'),
    signature: headers.get('svix-signature'),
  };
}

/**
 * The same three values under their Standard Webhooks names, which is what
 * Supabase Auth signs its send-email hook with.
 *
 * Svix wrote that spec, so the signature itself is byte for byte what `verifySvix`
 * already checks. Only the header prefix differs, and only the secret carries an
 * extra `v1,` in front of the `whsec_`.
 */
export function readStandardWebhookHeaders(headers: Headers): SvixHeaders {
  return {
    id: headers.get('webhook-id'),
    timestamp: headers.get('webhook-timestamp'),
    signature: headers.get('webhook-signature'),
  };
}

/**
 * The HMAC key out of whichever shape the dashboard handed over.
 *
 * Resend shows `whsec_<base64>`; Supabase shows `v1,whsec_<base64>`. Only the
 * base64 is the key, and pasting either one whole has to keep working, because
 * the failure mode is a signature that never verifies and a webhook that looks
 * like it is being ignored.
 */
function keyOf(secret: string): Buffer {
  return Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
}

/**
 * True when this body really came from Resend, recently.
 *
 * The replay window matters as much as the signature: a signed request stays
 * signed forever, so without a timestamp check somebody who captured one bounce
 * notification could suppress an address again at any point in the future.
 */
export function verifySvix(
  body: string,
  headers: SvixHeaders,
  secret: string | undefined,
  now = Date.now(),
): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;

  const sent = Number(headers.timestamp) * 1000;
  if (!Number.isFinite(sent) || Math.abs(now - sent) > TIMESTAMP_TOLERANCE_MS) return false;

  const key = keyOf(secret);
  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${body}`)
    .digest('base64');

  // The header carries a space-separated list, each entry versioned, because a
  // secret being rotated means two valid signatures for a while.
  return headers.signature
    .split(' ')
    .filter((entry) => entry.startsWith('v1,'))
    .some((entry) => equal(entry.slice(3), expected));
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Signs a body the way Resend does. Used by the tests, and by nothing else. */
export function signSvix(body: string, id: string, timestamp: string, secret: string): string {
  const key = keyOf(secret);
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

export interface ResendEvent {
  type: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

/**
 * Should this address stop receiving mail?
 *
 * A permanent bounce means the address does not exist, and a complaint means
 * somebody pressed "spam". Sending again after either one is how a domain loses
 * its reputation. A transient bounce is a full mailbox or a busy server, which is
 * worth retrying and not worth suppressing.
 */
export function suppressionReason(event: ResendEvent): string | null {
  if (event.type === 'email.complained') return 'complaint';
  if (event.type === 'email.bounced') {
    const type = event.data?.bounce?.type?.toLowerCase() ?? '';
    return type === 'permanent' ? 'hard bounce' : null;
  }
  return null;
}

export function recipientOf(event: ResendEvent): string | null {
  const to = event.data?.to;
  if (Array.isArray(to)) return to[0] ?? null;
  return typeof to === 'string' ? to : null;
}
