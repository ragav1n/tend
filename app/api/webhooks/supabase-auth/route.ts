import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readAuthHook } from '@/lib/email/auth-code';
import { renderSignInCode } from '@/lib/email/render';
import { sendEmail } from '@/lib/email/send';
import { readStandardWebhookHeaders, verifySvix } from '@/lib/email/webhook';

/**
 * Supabase's send-email hook. This is how a sign-in code gets sent.
 *
 * With the hook enabled Supabase stops mailing auth tokens itself and posts them
 * here, so the code arrives in the same design as every other Tend email and goes
 * out through Resend rather than through Supabase's own SMTP and its cap of two an
 * hour. Turning the hook off in the dashboard puts the default templates back,
 * which is the rollback if this route ever misbehaves.
 *
 * The body is read as text and verified before it is parsed, the same order the
 * Resend webhook uses and for the same reason: the signature covers the raw bytes,
 * and parsing first means an attacker's JSON has already been through the parser.
 *
 * **Status codes carry meaning to Supabase here, unlike in the Resend webhook.**
 * A 200 tells it the mail was sent, so a failure that answers 200 turns into a
 * person staring at a code box that will never fill. Everything that stops the
 * send answers non-2xx on purpose, and Supabase shows the client an error.
 */
export async function POST(request: Request) {
  const body = await request.text();

  if (
    !verifySvix(
      body,
      readStandardWebhookHeaders(request.headers),
      process.env.AUTH_EMAIL_HOOK_SECRET,
    )
  ) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'body must be json' }, { status: 400 });
  }

  const hook = readAuthHook(parsed);
  if ('error' in hook) {
    return NextResponse.json({ error: hook.error }, { status: 400 });
  }

  const rendered = await renderSignInCode(hook.code);

  try {
    const outcome = await sendEmail({
      ...rendered,
      to: hook.email,
      // A fresh key every time. The other emails key off a group's membership so
      // a retry replays instead of sending twice, but two requests for a code are
      // two different codes and the second has to arrive.
      idempotencyKey: `auth-code:${randomUUID()}`,
    });

    // `off` is the default outside a production deployment, and it means nothing
    // left the process. Reporting that as success would be the silent failure
    // this route exists to avoid.
    if (outcome.mode === 'off') {
      return NextResponse.json(
        { error: 'EMAIL_MODE is off, so no sign-in code was sent' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (failure) {
    // Resend refused, or a dev guard did. Either way the code did not go out, so
    // say so rather than leaving somebody waiting on an email that is not coming.
    const message = failure instanceof Error ? failure.message : 'send failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
