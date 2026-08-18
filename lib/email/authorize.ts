import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Is this request the cron?
 *
 * Two shapes are accepted because two callers exist. `pg_net` sends the secret in
 * `x-cron-secret`, which is what the tick in 0008 sets from Vault. Vercel's own
 * scheduler sends `Authorization: Bearer $CRON_SECRET` and cannot be told to send
 * anything else.
 *
 * Compared through a SHA-256 digest so the comparison is constant length and
 * constant time. Comparing the raw strings leaks the secret's length, and an
 * early-exit compare leaks a prefix.
 */
export function isCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;

  const header =
    request.headers.get('x-cron-secret')?.trim() ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  if (!header) return false;

  return timingSafeEqual(digest(header), digest(expected));
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
