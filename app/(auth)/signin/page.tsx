'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { ArrowRight, EnvelopeSimple, GoogleLogo } from '@phosphor-icons/react/dist/ssr';
import { APP_NAME, APP_TAGLINE } from '@/lib/config';
import { MarkTile } from '@/components/brand/Mark';
import { getSupabase } from '@/lib/supabase/client';
import { MIN_CODE, normalizeCode, verifyEmailCode } from '@/lib/supabase/verify-code';
import { FADE, PRESS_DEPTH, QUICK_FADE } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Sign in.
 *
 * Deliberately not a wall. Every read in this app comes from IndexedDB, so the
 * whole thing works signed out and works offline, and nothing routes you here.
 * Signing in adds sync; it does not unlock the app. That is why this page is
 * reached from the sync badge rather than from a redirect.
 *
 * The email step ends in a code box rather than in "check your email", because
 * an installed app cannot be signed in by a link. The link opens the browser,
 * which on iOS is a different storage container, so the session it creates is
 * not the app's session and the PKCE verifier the app wrote is not there to
 * exchange. `verifyEmailCode` carries the whole explanation. The email still
 * carries a link for anyone reading it on the same browser they asked from; the
 * code is what works everywhere, so the code is what the form asks for.
 *
 * Google is second because it needs a client id and secret pasted into the
 * dashboard first, so its button explains itself when the project has not been
 * set up for it.
 */

const CONTROL = cn(
  'w-full rounded-md border border-line bg-sunken px-3 py-2.5',
  'text-sm text-text-hi placeholder:text-text-lo',
  'focus:border-clay-400 focus:outline-none',
);

const PRIMARY = cn(
  'flex w-full items-center justify-center gap-2 rounded-md border border-clay-400',
  'bg-clay-600 px-3 py-2.5 text-sm text-on-accent hover:bg-clay-500',
  'disabled:opacity-60',
);

function SignInForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));
  // Whether the message on screen is still the one the callback redirected with.
  // The two hints below explain a failed *link*, so they have to stop showing
  // the moment a failed code replaces it, or a wrong digit gets told the link
  // opened in the wrong browser.
  const [fromLink, setFromLink] = useState(params.get('error') !== null);
  const errorCode = fromLink ? params.get('code') : null;

  function fail(message: string) {
    setFromLink(false);
    setError(message);
  }

  function clearError() {
    setFromLink(false);
    setError(null);
  }

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (email.trim().length === 0 || busy) return;

    setBusy(true);
    clearError();
    const { error: failure } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      // The link is the second way in, not the first, and it only ever works in
      // the browser that asked for it. Pointed at the callback because the
      // default Supabase template sends people through its own verify endpoint,
      // which hands back a PKCE code. Both routes accept either shape, so
      // customizing the template to {{ .TokenHash }} later needs no change here.
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/today` },
    });
    setBusy(false);

    if (failure) {
      fail(failure.message);
      return;
    }
    setCode('');
    setStage('code');
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    // A floor, not a length. How many digits the project issues is a dashboard
    // setting this page cannot read, so it accepts anything from the shortest
    // Supabase will mint upwards.
    if (code.length < MIN_CODE || busy) return;

    setBusy(true);
    clearError();
    const failure = await verifyEmailCode(email.trim(), code);

    if (failure) {
      setBusy(false);
      fail(failure);
      return;
    }
    // A full navigation rather than a router push, so the server sees the
    // session cookie the client just wrote and the shell renders signed in on
    // its first paint. `replace`, so back does not land on a spent code.
    window.location.replace('/today');
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={FADE}
      className="w-full max-w-sm"
    >
      <div className="mb-8 text-center">
        <MarkTile size={44} className="mx-auto mb-4" />
        <h1 className="font-display text-4xl leading-none">{APP_NAME}</h1>
        <p className="label mt-2 !text-[0.5625rem]">{APP_TAGLINE}</p>
      </div>

      <div
        className="rounded-lg border border-line bg-surface p-5"
        style={{ boxShadow: 'var(--shadow-raised)' }}
      >
        {stage === 'code' ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={QUICK_FADE}
          >
            <div className="pb-1 text-center">
              <EnvelopeSimple size={26} className="mx-auto mb-3 text-olive-300" aria-hidden />
              <p className="text-sm text-text-hi">Enter the code we sent</p>
              <p className="mx-auto mt-1.5 max-w-[32ch] text-xs text-text-lo">
                Sent to {email.trim()}. It expires in an hour.
              </p>
            </div>

            <form onSubmit={verify} className="mt-4 space-y-2.5">
              <label htmlFor="code" className="label !text-[0.5625rem]">
                Code
              </label>
              <input
                id="code"
                name="code"
                value={code}
                onChange={(e) => setCode(normalizeCode(e.target.value))}
                // No placeholder. A row of six zeroes was a promise about the
                // length, and the length is a dashboard setting.
                inputMode="numeric"
                // iOS reads the code out of Mail and offers it above the
                // keyboard, which turns the whole thing into one tap. It only
                // does that for this autocomplete token.
                autoComplete="one-time-code"
                enterKeyHint="go"
                autoFocus
                required
                className={cn(CONTROL, 'tnum text-center text-lg tracking-[0.35em]')}
                style={{ boxShadow: 'var(--shadow-sunken)' }}
              />
              <motion.button
                type="submit"
                disabled={busy || code.length < MIN_CODE}
                whileTap={{ y: 1 }}
                transition={PRESS_DEPTH}
                className={PRIMARY}
                style={{ boxShadow: 'var(--shadow-flush)' }}
              >
                {busy ? 'Signing in' : 'Sign in'}
                {!busy && <ArrowRight size={15} weight="bold" aria-hidden />}
              </motion.button>
            </form>

            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={busy}
                className="label !text-[0.5625rem] hover:text-text-mid disabled:opacity-60"
              >
                Send another
              </button>
              <span className="h-3 w-px bg-line" />
              <button
                type="button"
                onClick={() => {
                  setStage('email');
                  clearError();
                }}
                className="label !text-[0.5625rem] hover:text-text-mid"
              >
                Change email
              </button>
            </div>
          </motion.div>
        ) : (
          <>
            <form onSubmit={sendCode} className="space-y-2.5">
              <label htmlFor="email" className="label !text-[0.5625rem]">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                enterKeyHint="send"
                required
                className={CONTROL}
                style={{ boxShadow: 'var(--shadow-sunken)' }}
              />
              <motion.button
                type="submit"
                disabled={busy}
                whileTap={{ y: 1 }}
                transition={PRESS_DEPTH}
                className={PRIMARY}
                style={{ boxShadow: 'var(--shadow-flush)' }}
              >
                {busy ? 'Sending' : 'Email me a code'}
                {!busy && <ArrowRight size={15} weight="bold" aria-hidden />}
              </motion.button>
            </form>

            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="label !text-[0.5625rem]">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <motion.button
              type="button"
              onClick={() => void withGoogle(fail, clearError)}
              whileTap={{ y: 1 }}
              transition={PRESS_DEPTH}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-md border border-line',
                'bg-raised px-3 py-2.5 text-sm text-text-mid hover:border-clay-400 hover:text-text-hi',
              )}
            >
              <GoogleLogo size={16} weight="bold" aria-hidden />
              Continue with Google
            </motion.button>
          </>
        )}

        {error && (
          <div role="alert" className="mt-3 space-y-1">
            <p className="text-xs text-clay-200">{error}</p>
            {/* Three failures have causes worth naming, because Supabase's own
                wording for all of them describes the mechanism rather than the
                thing the person actually did. */}
            {errorCode === 'otp_expired' && (
              <p className="text-xs text-text-lo">
                Sign-in links are single use, and some mail providers open them
                automatically while scanning. Sending a fresh one usually works.
              </p>
            )}
            {errorCode === 'pkce_code_verifier_not_found' && (
              <p className="text-xs text-text-lo">
                That link opened somewhere other than where it was asked for, and
                an installed app counts as somewhere else. Use the code in the
                same email instead.
              </p>
            )}
            {errorCode && <p className="tnum text-[0.625rem] text-text-faint">{errorCode}</p>}
          </div>
        )}
      </div>

      <p className="mt-5 text-center text-xs text-text-lo">
        Tend works without an account. Signing in backs it up and syncs your devices.
      </p>
    </motion.div>
  );
}

/** Google is a redirect rather than a code, and a redirect out of an installed
 *  app comes back to it, because the browser is only ever a passenger here. */
async function withGoogle(fail: (message: string) => void, clearError: () => void) {
  clearError();
  const { error: failure } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback?next=/today` },
  });
  if (failure) {
    fail(
      failure.message.includes('not enabled')
        ? 'Google is not enabled on this Supabase project yet. The email code works now.'
        : failure.message,
    );
  }
}

export default function SignInPage() {
  return (
    <main className={cn(
        'flex min-h-dvh items-center justify-center',
        'pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))]',
        'pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))]',
      )}>
      {/* useSearchParams needs a Suspense boundary, or the whole route opts out
          of static rendering and the shell stops arriving in the first paint. */}
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
