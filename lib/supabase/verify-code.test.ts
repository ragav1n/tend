import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CODE, MIN_CODE, normalizeCode, verifyEmailCode } from './verify-code';

/**
 * The code path exists because a link cannot sign in an installed app, so the
 * things that would send someone back to a broken link are what get held here: a
 * pasted code that does not verify because of the characters around it, a first
 * ever sign-in that fails because the token was issued as a signup, and the length
 * of the code itself.
 *
 * That last one shipped broken. `slice(0, 6)` looked like a harmless guard and was
 * a guess about a dashboard setting: a project set to eight digits mailed eight,
 * the field kept six, and the code in the email could not be used at all.
 */

const verifyOtp = vi.fn();

vi.mock('./client', () => ({
  getSupabase: () => ({ auth: { verifyOtp } }),
}));

beforeEach(() => {
  verifyOtp.mockReset();
});

describe('normalizeCode', () => {
  it('keeps the digits out of whatever the mail client pasted', () => {
    expect(normalizeCode(' 123456\n')).toBe('123456');
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('Your code is 123456')).toBe('123456');
  });

  it('keeps a code longer than six, because the length is a project setting', () => {
    // The regression. Supabase allows six to ten digits and this project is set
    // to eight, so cutting at six made every emailed code unusable.
    expect(normalizeCode('48291573')).toBe('48291573');
    expect(normalizeCode(' 4829 1573 ')).toBe('48291573');
    expect(normalizeCode('1234567890')).toBe('1234567890');
  });

  it('stops at the longest a project can issue, so a double paste cannot grow it', () => {
    expect(normalizeCode('1'.repeat(20))).toHaveLength(MAX_CODE);
    expect(MIN_CODE).toBe(6);
    expect(MAX_CODE).toBe(10);
  });

  it('drops a lone non-digit rather than holding it', () => {
    expect(normalizeCode('abc')).toBe('');
  });

  it('pulls the code out of a sentence of any length', () => {
    expect(normalizeCode('Your code is 48291573')).toBe('48291573');
  });
});

describe('verifyEmailCode', () => {
  it('verifies a returning user in one call', async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });

    expect(await verifyEmailCode('a@b.com', '123456')).toBeNull();
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      token: '123456',
      type: 'email',
    });
  });

  it('sends whatever length the code is, without trimming it', async () => {
    verifyOtp.mockResolvedValueOnce({ error: null });

    expect(await verifyEmailCode('a@b.com', '48291573')).toBeNull();
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      token: '48291573',
      type: 'email',
    });
  });

  it('retries as a signup, because a first sign-in created the account', async () => {
    verifyOtp
      .mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } })
      .mockResolvedValueOnce({ error: null });

    expect(await verifyEmailCode('a@b.com', '123456')).toBeNull();
    expect(verifyOtp).toHaveBeenCalledTimes(2);
    expect(verifyOtp).toHaveBeenLastCalledWith({
      email: 'a@b.com',
      token: '123456',
      type: 'signup',
    });
  });

  it('reports the first failure, not the retry, when the code is simply wrong', async () => {
    verifyOtp
      .mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } })
      .mockResolvedValueOnce({ error: { message: 'Signup requires a valid password' } });

    expect(await verifyEmailCode('a@b.com', '000000')).toBe('Token has expired or is invalid');
  });
});
