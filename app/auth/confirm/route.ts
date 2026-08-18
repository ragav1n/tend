import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getServerSupabase } from '@/lib/supabase/server';

/**
 * Where a magic link lands.
 *
 * Email links carry a `token_hash` rather than an OAuth code, so they are
 * verified rather than exchanged. Same reason as the callback route: doing it
 * on the server puts the session in an httpOnly cookie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = url.searchParams.get('next') ?? '/today';

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL('/signin?error=invalid_link', url.origin));
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(
      new URL(`/signin?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/today';
  return NextResponse.redirect(new URL(target, url.origin));
}
