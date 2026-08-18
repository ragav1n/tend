import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getServerSupabase } from './server';

/**
 * Finishes a sign-in, whatever shape the redirect arrives in.
 *
 * Three shapes reach these routes, and which one you get depends on a template
 * setting in a dashboard rather than on anything in this codebase:
 *
 *   * `?code=` from OAuth, and from a magic link whose email template uses the
 *     default `{{ .ConfirmationURL }}`. Supabase verifies the token on its own
 *     side first and hands back a PKCE code to exchange.
 *   * `?token_hash=&type=` from a magic link whose template was customized to
 *     `{{ .TokenHash }}`, which skips the hop through Supabase.
 *   * `?error=&error_code=` when the link expired, was already used, or pointed
 *     somewhere the project's redirect allowlist does not permit.
 *
 * Handling one and guessing at the others is how "invalid link" ends up being
 * the only thing anybody ever sees. The third case in particular is a real
 * message from Supabase that is worth passing through verbatim.
 */
export async function completeAuth(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const params = url.searchParams;

  const next = params.get('next') ?? '/today';
  // Only same-origin paths, so a crafted `next` cannot bounce a freshly signed
  // in user to another site.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/today';

  function back(message: string, code?: string | null): NextResponse {
    const to = new URL('/signin', url.origin);
    to.searchParams.set('error', message);
    if (code) to.searchParams.set('code', code);
    return NextResponse.redirect(to);
  }

  // Supabase said no before we ever got a token. Pass its own words along.
  const supabaseError = params.get('error_description') ?? params.get('error');
  if (supabaseError) {
    return back(supabaseError, params.get('error_code'));
  }

  const supabase = await getServerSupabase();

  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return back(error.message, error.code);
    return NextResponse.redirect(new URL(target, url.origin));
  }

  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return back(error.message, error.code);
    return NextResponse.redirect(new URL(target, url.origin));
  }

  // An implicit-flow link puts its tokens in the URL fragment, which never
  // reaches the server. Saying so beats "invalid link", because the fix is a
  // project setting rather than anything the person clicking can do.
  return back(
    'That link carried no sign-in token. If it came from an older email, request a new one.',
  );
}
