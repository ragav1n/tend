import { NextResponse } from 'next/server';
import { appUrl } from '@/lib/email/env';
import { readUnsubscribeToken, type UnsubscribeClaims } from '@/lib/email/unsubscribe';
import { getAdminSupabase } from '@/lib/supabase/admin';

/**
 * Turns off one kind of email, or all of them.
 *
 * No cookies, no session, no CSRF token. A one-click unsubscribe arrives from the
 * mail provider's servers, not the reader's browser, so the signed token in the
 * URL is the entire authorization and this route has to work with nothing else.
 *
 * Idempotent by construction: it sets a boolean to false. Clicking twice, or a
 * provider prefetching the link, changes nothing the second time.
 */
const COLUMN: Record<UnsubscribeClaims['kind'], string> = {
  all: 'email_enabled',
  daily_digest: 'digest_enabled',
  overdue_nudge: 'nudge_enabled',
  weekly_review: 'weekly_review_enabled',
  task_reminder: 'reminders_enabled',
};

const LABEL: Record<UnsubscribeClaims['kind'], string> = {
  all: 'every email from Tend',
  daily_digest: 'the morning digest',
  overdue_nudge: 'the overdue nudge',
  weekly_review: 'the weekly review',
  task_reminder: 'task reminders',
};

async function apply(token: string | null): Promise<{ ok: boolean; message: string }> {
  const claims = token ? readUnsubscribeToken(token) : null;
  if (!claims) {
    return { ok: false, message: 'That link is not valid.' };
  }

  const supabase = getAdminSupabase();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', claims.email)
    .maybeSingle();

  if (!profile) {
    // Answered the same way as a valid link. A different answer here turns this
    // route into a way to ask whether an address has an account.
    return { ok: true, message: `You will not get ${LABEL[claims.kind]} again.` };
  }

  const { data: settings } = await supabase
    .from('user_settings')
    .select('email_token_version')
    .eq('user_id', profile.id)
    .maybeSingle();

  // Bumping email_token_version revokes every link already sitting in an inbox.
  if (!settings || settings.email_token_version !== claims.version) {
    return { ok: false, message: 'That link has expired. Change it in settings instead.' };
  }

  const { error } = await supabase
    .from('user_settings')
    .update({ [COLUMN[claims.kind]]: false })
    .eq('user_id', profile.id);

  if (error) {
    return { ok: false, message: 'Something went wrong. Try it from settings.' };
  }

  return { ok: true, message: `Done. You will not get ${LABEL[claims.kind]} again.` };
}

function page(message: string): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tend</title>
  </head>
  <body style="margin:0;background:#FAF7F2;color:#2B2D31;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <main style="max-width:32rem;margin:0 auto;padding:12vh 1.5rem">
      <p style="font:400 20px/1.4 Georgia,serif;color:#3A4027;margin:0 0 0.5rem">Tend</p>
      <p style="margin:0 0 1.5rem">${message}</p>
      <a href="${appUrl()}/today" style="color:#8D321F">Open Tend</a>
    </main>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('t');
  const { message } = await apply(token);
  return page(message);
}

/** RFC 8058 one-click. The provider wants a status code, not a page. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get('t');

  if (!token) {
    // Some providers POST the form body instead of keeping the query string.
    const body = await request.text();
    token = new URLSearchParams(body).get('t');
  }

  const { ok, message } = await apply(token);
  return NextResponse.json({ ok, message }, { status: ok ? 200 : 400 });
}
