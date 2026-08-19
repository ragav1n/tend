import { NextResponse } from 'next/server';
import {
  readSvixHeaders,
  recipientOf,
  suppressionReason,
  verifySvix,
  type ResendEvent,
} from '@/lib/email/webhook';
import { getAdminSupabase } from '@/lib/supabase/admin';

/**
 * What Resend has to say about the mail that went out.
 *
 * The body is read as text and verified before it is parsed, because the
 * signature covers the raw bytes and because parsing an unverified body is
 * parsing an attacker's input.
 *
 * A hard bounce or a complaint suppresses the address and turns that account's
 * email off. Both are checked again at claim time, so a suppression landing in the
 * middle of a batch still takes effect on the rest of it.
 */
export async function POST(request: Request) {
  const body = await request.text();

  if (!verifySvix(body, readSvixHeaders(request.headers), process.env.RESEND_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ error: 'body must be json' }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const messageId = event.data?.email_id ?? null;

  const { data: delivery } = messageId
    ? await supabase
        .from('reminder_deliveries')
        .select('id, user_id')
        .eq('provider_message_id', messageId)
        .maybeSingle()
    : { data: null };

  // Kept whether or not it maps to a delivery. An event about mail this app did
  // not send is still worth having when a domain's reputation is in question.
  await supabase.from('email_events').insert({
    delivery_id: delivery?.id ?? null,
    provider_message_id: messageId,
    type: event.type,
    raw: event as unknown as Record<string, unknown>,
  });

  const reason = suppressionReason(event);
  const recipient = recipientOf(event);

  if (reason && recipient) {
    await supabase
      .from('email_suppressions')
      .upsert({ email: recipient, reason }, { onConflict: 'email' });

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', recipient)
      .maybeSingle();

    if (profile) {
      await supabase
        .from('user_settings')
        .update({ email_enabled: false })
        .eq('user_id', profile.id);
    }
  }

  // 200 for anything understood, because a webhook that returns an error gets
  // retried, and retrying a bounce notification changes nothing.
  return NextResponse.json({ ok: true, suppressed: Boolean(reason) });
}
