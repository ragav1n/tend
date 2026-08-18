'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { ArrowRight, EnvelopeSimple, GoogleLogo } from '@phosphor-icons/react/dist/ssr';
import { APP_NAME, APP_TAGLINE } from '@/lib/config';
import { getSupabase } from '@/lib/supabase/client';
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
 * Two methods, and the order is on purpose. The magic link needs no
 * configuration at all, so it works the moment a Supabase project exists.
 * Google needs a client id and secret pasted into the dashboard first, so its
 * button explains itself when the project has not been set up for it.
 */

const CONTROL = cn(
  'w-full rounded-md border border-line bg-sunken px-3 py-2.5',
  'text-sm text-text-hi placeholder:text-text-lo',
  'focus:border-clay-400 focus:outline-none',
);

function SignInForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));
  const errorCode = params.get('code');

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    if (email.trim().length === 0 || busy) return;

    setBusy(true);
    setError(null);
    const { error: failure } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      // The default Supabase email template sends people through its own
      // verify endpoint, which hands back a PKCE code, so this points at the
      // callback. Both routes accept either shape, so customizing the
      // template to {{ .TokenHash }} later needs no change here.
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/today` },
    });
    setBusy(false);

    if (failure) {
      setError(failure.message);
      return;
    }
    setSent(true);
  }

  async function withGoogle() {
    setError(null);
    const { error: failure } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/today` },
    });
    if (failure) {
      setError(
        failure.message.includes('not enabled')
          ? 'Google is not enabled on this Supabase project yet. The email link works now.'
          : failure.message,
      );
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={FADE}
      className="w-full max-w-sm"
    >
      <div className="mb-8 text-center">
        <h1 className="font-display text-4xl leading-none">{APP_NAME}</h1>
        <p className="label mt-2 !text-[0.5625rem]">{APP_TAGLINE}</p>
      </div>

      <div
        className="rounded-lg border border-line bg-surface p-5"
        style={{ boxShadow: 'var(--shadow-raised)' }}
      >
        {sent ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={QUICK_FADE}
            className="py-4 text-center"
          >
            <EnvelopeSimple size={26} className="mx-auto mb-3 text-olive-300" aria-hidden />
            <p className="text-sm text-text-hi">Check your email</p>
            <p className="mx-auto mt-1.5 max-w-[30ch] text-xs text-text-lo">
              The link signs you in and comes straight back here. It expires in an hour.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="label mt-4 !text-[0.5625rem] hover:text-text-mid"
            >
              Use a different address
            </button>
          </motion.div>
        ) : (
          <>
            <form onSubmit={sendLink} className="space-y-2.5">
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
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-md border border-clay-400',
                  'bg-clay-600 px-3 py-2.5 text-sm text-text-hi hover:bg-clay-500',
                  'disabled:opacity-60',
                )}
                style={{ boxShadow: 'var(--shadow-flush)' }}
              >
                {busy ? 'Sending' : 'Send a sign-in link'}
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
              onClick={() => void withGoogle()}
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
            {/* Two failures have causes worth naming, because Supabase's own
                wording for both describes the mechanism rather than the thing
                the person actually did. */}
            {errorCode === 'otp_expired' && (
              <p className="text-xs text-text-lo">
                Sign-in links are single use, and some mail providers open them
                automatically while scanning. Sending a fresh one usually works.
              </p>
            )}
            {errorCode === 'pkce_code_verifier_not_found' && (
              <p className="text-xs text-text-lo">
                The link has to open in the same browser you asked for it from.
                A private window counts as a different browser, and so does
                opening it on your phone. Request one here and click it here.
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

export default function SignInPage() {
  return (
    <main className="safe-top safe-x flex min-h-dvh items-center justify-center px-4 py-10">
      {/* useSearchParams needs a Suspense boundary, or the whole route opts out
          of static rendering and the shell stops arriving in the first paint. */}
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
