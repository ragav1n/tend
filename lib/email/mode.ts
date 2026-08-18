import { appUrl } from './env';

/**
 * The dev guards, because one is never enough and sending a real email to a real
 * person from a laptop is the mistake that actually happens.
 *
 *   off      nothing leaves, and nothing is rendered to the log either
 *   console  the whole pipeline runs and the rendered mail goes to the log
 *   catchall recipients are rewritten to one inbox, subject keeps the original
 *   live     Resend
 *
 * Default is `live` on a production deployment and `off` everywhere else, so a
 * missing variable fails safe. `live` outside production is refused outright
 * unless somebody says so in writing with EMAIL_ALLOW_LIVE.
 */
export type EmailMode = 'off' | 'console' | 'catchall' | 'live';

const MODES: EmailMode[] = ['off', 'console', 'catchall', 'live'];

export function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

export function resolveMode(): EmailMode {
  const raw = process.env.EMAIL_MODE?.trim().toLowerCase();
  const mode = MODES.includes(raw as EmailMode) ? (raw as EmailMode) : undefined;

  if (!mode) {
    if (raw) throw new Error(`EMAIL_MODE must be one of ${MODES.join(', ')}, got "${raw}"`);
    return isProduction() ? 'live' : 'off';
  }

  if (mode === 'live' && !isProduction() && process.env.EMAIL_ALLOW_LIVE !== 'true') {
    // The specific accident this stops: running the app locally against the
    // production Supabase project, whose user_settings hold real addresses.
    throw new Error(
      'EMAIL_MODE=live outside a production deployment. Set EMAIL_ALLOW_LIVE=true if that ' +
        'is really what you want, or use catchall.',
    );
  }

  return mode;
}

/**
 * The recipient this send should actually use.
 *
 * In catchall the original goes into the subject, because a dev inbox holding
 * forty identical "Today" emails tells you nothing about who each was for.
 */
export function rewriteRecipient(
  to: string,
  subject: string,
  mode: EmailMode,
): { to: string; subject: string } {
  if (mode !== 'catchall') return { to, subject };

  const inbox = process.env.EMAIL_DEV_INBOX?.trim();
  if (!inbox) throw new Error('EMAIL_MODE=catchall needs EMAIL_DEV_INBOX');
  return { to: inbox, subject: `[${to}] ${subject}` };
}

/**
 * Throws before the send call when the address is not one this environment is
 * allowed to write to. Outside production the allowlist is the whole defence, so
 * an empty list means nothing goes out rather than everything.
 */
export function assertSendable(to: string, mode: EmailMode): void {
  if (mode === 'off' || mode === 'console') return;
  if (isProduction()) return;

  const domains = (process.env.EMAIL_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const domain = to.split('@')[1]?.toLowerCase() ?? '';

  if (!domains.includes(domain)) {
    throw new Error(
      `refusing to send to ${to} outside production. Add its domain to EMAIL_ALLOWED_DOMAINS ` +
        `(currently ${domains.length === 0 ? 'empty' : domains.join(', ')}).`,
    );
  }
}

/** One line in the log describing the environment, for the heartbeat detail. */
export function describeMode(mode: EmailMode): string {
  return `${mode} via ${appUrl()}`;
}
