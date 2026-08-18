import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

/**
 * Where an OAuth provider sends the browser back.
 *
 * The code is exchanged on the server so the resulting session lands in an
 * httpOnly cookie rather than in localStorage, which is what lets `proxy.ts`
 * refresh it and what keeps it out of reach of any script on the page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/today';

  if (!code) {
    return NextResponse.redirect(new URL('/signin?error=missing_code', url.origin));
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/signin?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  // Only same-origin paths, so a crafted `next` cannot bounce a freshly signed
  // in user off to another site carrying their referrer.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/today';
  return NextResponse.redirect(new URL(target, url.origin));
}
