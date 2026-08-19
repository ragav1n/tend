import { describe, expect, it } from 'vitest';
import {
  recipientOf,
  signSvix,
  suppressionReason,
  TIMESTAMP_TOLERANCE_MS,
  verifySvix,
} from './webhook';

/**
 * The webhook, which is the one endpoint an outsider can reach with a body that
 * changes whether somebody gets email. So the signature is the whole door.
 */

const SECRET = `whsec_${Buffer.from('a-webhook-signing-key').toString('base64')}`;
const NOW = Date.parse('2026-09-01T12:00:00Z');
const BODY = JSON.stringify({ type: 'email.bounced', data: { email_id: 'abc' } });

function headers(over: { id?: string; timestamp?: string; signature?: string } = {}) {
  const id = over.id ?? 'msg_1';
  const timestamp = over.timestamp ?? String(Math.floor(NOW / 1000));
  return {
    id,
    timestamp,
    signature: over.signature ?? signSvix(BODY, id, timestamp, SECRET),
  };
}

describe('verification', () => {
  it('accepts a signature Resend would have produced', () => {
    expect(verifySvix(BODY, headers(), SECRET, NOW)).toBe(true);
  });

  it('accepts one of several signatures during a rotation', () => {
    const real = headers();
    const both = { ...real, signature: `v1,wrong ${real.signature}` };
    expect(verifySvix(BODY, both, SECRET, NOW)).toBe(true);
  });

  it('rejects a body that changed after signing', () => {
    const tampered = JSON.stringify({ type: 'email.bounced', data: { email_id: 'other' } });
    expect(verifySvix(tampered, headers(), SECRET, NOW)).toBe(false);
  });

  it('rejects a replay from outside the window', () => {
    const stale = String(Math.floor((NOW - TIMESTAMP_TOLERANCE_MS - 1000) / 1000));
    // A signed request stays signed forever. Without this, one captured bounce
    // notification could suppress an address at any point in the future.
    expect(verifySvix(BODY, headers({ timestamp: stale }), SECRET, NOW)).toBe(false);
  });

  it('rejects a missing header, a missing secret and a missing signature', () => {
    expect(verifySvix(BODY, { ...headers(), id: null }, SECRET, NOW)).toBe(false);
    expect(verifySvix(BODY, headers(), undefined, NOW)).toBe(false);
    expect(verifySvix(BODY, { ...headers(), signature: 'v1,' }, SECRET, NOW)).toBe(false);
  });
});

describe('what counts as a suppression', () => {
  it('suppresses a permanent bounce and a complaint', () => {
    expect(
      suppressionReason({ type: 'email.bounced', data: { bounce: { type: 'Permanent' } } }),
    ).toBe('hard bounce');
    expect(suppressionReason({ type: 'email.complained' })).toBe('complaint');
  });

  it('leaves a full mailbox alone', () => {
    // Transient means the server was busy or the box was full, both of which are
    // worth another try and neither of which is worth cutting somebody off for.
    expect(
      suppressionReason({ type: 'email.bounced', data: { bounce: { type: 'Transient' } } }),
    ).toBeNull();
    expect(suppressionReason({ type: 'email.delivered' })).toBeNull();
  });

  it('reads the recipient whichever shape it arrives in', () => {
    expect(recipientOf({ type: 'x', data: { to: ['me@example.com'] } })).toBe('me@example.com');
    expect(recipientOf({ type: 'x', data: { to: 'me@example.com' } })).toBe('me@example.com');
    expect(recipientOf({ type: 'x' })).toBeNull();
  });
});
