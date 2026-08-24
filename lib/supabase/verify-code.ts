'use client';

import { getSupabase } from './client';

/** How many digits Supabase puts in an emailed sign-in code. */
export const CODE_LENGTH = 6;

/**
 * Digits only, capped at the length of a real code.
 *
 * People paste rather than type, and a pasted code arrives with whatever the
 * mail client had around it: a leading space, a trailing newline, sometimes the
 * whole "Your code is 123456" sentence. Stripping here means the button enables
 * itself when the code is actually complete instead of waiting for a character
 * that is never coming.
 */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH);
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
