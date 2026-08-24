'use client';

import { getSupabase } from './client';

/**
 * How long an emailed code may be.
 *
 * **Not six.** The length is a project setting (Authentication > Sign In /
 * Providers > Email > Email OTP Length) and Supabase allows six to ten. Assuming
 * six here is the bug that shipped: a project set to eight sent an eight digit
 * code, `normalizeCode` cut it to six, and the code in the email could never
 * verify. Nothing in the client can read that setting, so the client has to
 * accept the whole range instead of picking a number out of it.
 */
export const MIN_CODE = 6;
export const MAX_CODE = 10;

/**
 * Digits only, capped at the longest code a project can be set to issue.
 *
 * People paste rather than type, and a pasted code arrives with whatever the
 * mail client had around it: a leading space, a trailing newline, sometimes the
 * whole "Your code is 12345678" sentence. Stripping here means the button enables
 * itself when the code is actually complete instead of waiting for a character
 * that is never coming.
 */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, MAX_CODE);
}

/**
 * Verifies an emailed code from inside the browsing context that asked for it.
 *
 * This exists because the magic link cannot work in an installed app, and the
 * reason is worth writing down before somebody tries to fix it again:
 *
 *   * iOS gives a home screen web app its own storage container. Tapping a link
 *     in Mail opens the browser, which is a different container, so the PKCE
 *     verifier that `signInWithOtp` just wrote is not there to be read. That is
 *     the `pkce_code_verifier_not_found` the sign-in page has copy for.
 *   * Even when the exchange succeeds, the session lands in the browser. The app
 *     on the home screen is still signed out, because it never saw the cookie.
 *   * There is no way out through the manifest. Link capturing is a Chromium
 *     feature; iOS has no equivalent and no API to ask for one.
 *
 * A code sidesteps all three. It travels through the person rather than through
 * storage, so the session is written by the client that asked for it.
 *
 * Two attempts, because the token's type depends on whether the user already
 * existed and the client cannot know: a returning user gets `email`, and a first
 * ever sign-in gets `signup`, since `signInWithOtp` created the account on the
 * way past. The first error is the one reported, because `email` is the ordinary
 * case and its message is the one that describes a wrong or expired code.
 */
export async function verifyEmailCode(email: string, code: string): Promise<string | null> {
  const supabase = getSupabase();

  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (!error) return null;

  const { error: asSignup } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: 'signup',
  });
  return asSignup ? error.message : null;
}
