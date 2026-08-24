import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CODE_LENGTH, normalizeCode, verifyEmailCode } from './verify-code';

/**
 * The code path exists because a link cannot sign in an installed app, so the
 * two things that would send someone back to a broken link are what get held
 * here: a pasted code that does not verify because of the characters around it,
 * and a first ever sign-in that fails because the token was issued as a signup.
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

  it('stops at the length of a real code, so a double paste cannot grow it', () => {
    expect(normalizeCode('123456789')).toHaveLength(CODE_LENGTH);
    expect(normalizeCode('123456123456')).toBe('123456');
  });

  it('drops a lone non-digit rather than holding it', () => {
    expect(normalizeCode('abc')).toBe('');
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
