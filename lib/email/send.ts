import { Resend } from 'resend';
import { emailFrom, requireEnv } from './env';
import { assertSendable, resolveMode, rewriteRecipient, type EmailMode } from './mode';
import type { RenderedEmail } from './types';

/**
 * One send, through whichever mode this environment is in.
 *
 * The idempotency key is the delivery's dedupe_key, so a retry after a crash
 * between "Resend accepted it" and "the row said sent" returns the original
 * result rather than mailing somebody twice. That window is the whole reason the
 * key exists.
 */
export interface Outgoing extends RenderedEmail {
  to: string;
  /** The delivery's dedupe_key. Deterministic, which is what makes it usable. */
  idempotencyKey: string;
}

export interface SendOutcome {
  mode: EmailMode;
  /** Resend's id, or null when nothing left the process. */
  id: string | null;
  to: string;
}

let client: Resend | null = null;

function resend(): Resend {
  client ??= new Resend(requireEnv('RESEND_API_KEY'));
  return client;
}

export async function sendEmail(outgoing: Outgoing): Promise<SendOutcome> {
  const mode = resolveMode();

  if (mode === 'off') {
    return { mode, id: null, to: outgoing.to };
  }

  const { to, subject } = rewriteRecipient(outgoing.to, outgoing.subject, mode);
  assertSendable(to, mode);

  if (mode === 'console') {
    // The whole pipeline runs and nothing touches the network, which is what
    // makes this the mode to develop in.
    console.info(
      ['', `to:      ${to}`, `subject: ${subject}`, '', outgoing.text, ''].join('\n'),
    );
    return { mode, id: null, to };
  }

  const { data, error } = await resend().emails.send(
    {
      from: emailFrom(),
      to,
      subject,
      html: outgoing.html,
      text: outgoing.text,
      headers: {
        // RFC 8058. Gmail and Outlook show a native unsubscribe control when both
        // headers are present, and a native control is the one people use instead
        // of the spam button.
        'List-Unsubscribe': `<${outgoing.unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    },
    { idempotencyKey: outgoing.idempotencyKey },
  );

  if (error) {
    throw new Error(`${error.name}: ${error.message}`);
  }

  return { mode, id: data?.id ?? null, to };
}
