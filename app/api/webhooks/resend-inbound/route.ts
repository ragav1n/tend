import { NextResponse } from 'next/server';
import { readSvixHeaders, verifySvix } from '@/lib/email/webhook';
import {
  capturePayload,
  messageIdOf,
  senderOf,
  stripHtml,
  toCapture,
  type InboundEvent,
} from '@/lib/email/inbound';
import { getAdminSupabase } from '@/lib/supabase/admin';

/**
 * Mail arriving at the capture address.
 *
 * Resend receives on a managed `<alias>@<id>.resend.app`, so there is no DNS to
 * set up and no domain to warm. The event is metadata only: the text is a
 * second call to the Resend API, which is why this route has an outbound fetch
 * in it at all.
 *
 * Service role, which this route is allowed to hold: it has no session, because
 * mail does not come with one. Everything is scoped explicitly instead. The
 * sender is resolved to an account through `profiles.email`, and every write
 * goes through `capture_email(p_user, …)` with that id, so a mail can only ever
 * write into the account it was sent from.
 *
 * ── The authorization, said plainly ───────────────────────────────────────
 *
 * An inbound address is guessable and unauthenticated by construction: anybody
 * who learns it can post to it. Two things stand in front of that. The Svix
 * signature proves the request came from Resend, and the From address has to
 * match an account. A From header is forgeable, so the second check stops
 * casual noise and somebody who knows your address, not a determined forger.
 * The blast radius is a task in your own Inbox, and the daily cap in SQL is
 * what bounds even that.
 *
 * ── Why it answers 200 to almost everything ───────────────────────────────
 *
 * Resend retries any non-2xx. A mail from an unknown sender will never become
 * valid, so retrying it is a queue that never drains. Only a bad signature gets
 * a 401, because that is the one case where the sender should learn nothing.
 */

export const dynamic = 'force-dynamic';

/** Enough of a mail to be a note. Past this it is a newsletter. */
const MAX_BODY_BYTES = 200_000;

export async function POST(request: Request) {
  const raw = await request.text();

  // Verified before parsed: the signature covers the raw bytes, and parsing an
  // unverified body is parsing an attacker's input.
  if (!verifySvix(raw, readSvixHeaders(request.headers), process.env.RESEND_INBOUND_SECRET)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let event: InboundEvent;
  try {
    event = JSON.parse(raw) as InboundEvent;
  } catch {
    return NextResponse.json({ error: 'body must be json' }, { status: 400 });
  }

  if (event.type !== 'email.received') {
    return NextResponse.json({ ok: true, ignored: 'not an inbound event' });
  }

  const sender = senderOf(event);
  const messageId = messageIdOf(event);
  if (sender === null || messageId === null) {
    return NextResponse.json({ ok: true, ignored: 'no sender or no id' });
  }

  const supabase = getAdminSupabase();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', sender)
    .maybeSingle();

  if (!profile) {
    // Never logged with the address attached. Somebody probing the endpoint
    // should not be able to confirm whether an address has an account.
    return NextResponse.json({ ok: true, ignored: 'unknown sender' });
  }

  const body = await fetchBody(messageId);
  const capture = toCapture(event, body);
  if (capture === null) {
    return NextResponse.json({ ok: true, ignored: 'nothing in the subject' });
  }

  const courseId = capture.courseCode
    ? await matchCourse(supabase, profile.id as string, capture.courseCode)
    : null;

  const { data: outcome, error } = await supabase.rpc('capture_email', {
    p_user: profile.id,
    p_item: capturePayload(capture, messageId, courseId),
  });

  if (error) {
    // The one case worth a retry: the write failed for a reason that might not
    // repeat.
    return NextResponse.json({ error: 'could not write it' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, outcome });
}

/**
 * The text of the mail.
 *
 * A separate call because `email.received` carries metadata only. A failure
 * here is not a failure of the capture: a task with a title and no notes is
 * most of the value, so this answers with an empty string rather than throwing
 * and losing the mail.
 */
async function fetchBody(messageId: string): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return '';

  try {
    const response = await fetch(`https://api.resend.com/emails/${messageId}/inbound`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!response.ok) return '';

    const payload = (await response.json()) as { text?: unknown; html?: unknown };
    if (typeof payload.text === 'string') return payload.text.slice(0, MAX_BODY_BYTES);
    // Plain text is what a note wants. HTML is stripped rather than rendered,
    // because notes are markdown and a mail's markup is not.
    if (typeof payload.html === 'string') return stripHtml(payload.html.slice(0, MAX_BODY_BYTES));
    return '';
  } catch {
    return '';
  }
}

/** The course a `+code` in the subject meant, folded the way quick-add folds. */
async function matchCourse(
  supabase: ReturnType<typeof getAdminSupabase>,
  userId: string,
  code: string,
): Promise<string | null> {
  const { data: courses } = await supabase
    .from('courses')
    .select('id, code')
    .eq('user_id', userId)
    .is('deleted_at', null);

  const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = fold(code);
  if (wanted === '' || !courses) return null;

  const exact = courses.filter((course) => fold(String(course.code)) === wanted);
  if (exact.length === 1) return exact[0]!.id as string;

  const prefixed = courses.filter((course) => fold(String(course.code)).startsWith(wanted));
  return prefixed.length === 1 ? (prefixed[0]!.id as string) : null;
}
