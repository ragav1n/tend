/**
 * The Supabase send-email hook, on the pure side.
 *
 * Enabling that hook means Supabase stops sending auth mail itself and posts the
 * token here instead, which buys three things: the code email is rendered by the
 * same React Email path as every other email in this app, a redesign ships with a
 * deploy rather than with a paste into a dashboard, and auth mail goes out through
 * Resend rather than through Supabase's built-in SMTP and its two an hour cap.
 *
 * The parsing and the subject live here rather than in the route, because a route
 * handler cannot be tested and these strings are the part worth holding.
 */

/** What Supabase posts. Only the fields this app reads are named. */
export interface AuthHookPayload {
  user?: { email?: string };
  email_data?: {
    token?: string;
    email_action_type?: string;
  };
}

/**
 * The action types this app can actually produce.
 *
 * `magiclink` is a returning user and `signup` is the first time, and those are
 * the only two `signInWithOtp` can raise. `recovery` needs a password and Tend
 * has none; `email_change`, `invite` and `reauthentication` need screens that do
 * not exist. Anything else is refused loudly rather than answered 200, because a
 * 200 tells Supabase the mail was sent and a silent nothing is the hardest
 * sign-in bug there is to find.
 */
export const HANDLED_ACTIONS = ['magiclink', 'signup'] as const;

export interface AuthCodeRequest {
  email: string;
  code: string;
  action: string;
}

/** The payload, or a sentence saying what was wrong with it. */
export function readAuthHook(body: unknown): AuthCodeRequest | { error: string } {
  const payload = body as AuthHookPayload;
  const email = payload?.user?.email?.trim();
  const code = payload?.email_data?.token?.trim();
  const action = payload?.email_data?.email_action_type?.trim() ?? '';

  if (!email) return { error: 'payload carried no user email' };
  if (!code) return { error: 'payload carried no token' };
  if (!HANDLED_ACTIONS.includes(action as (typeof HANDLED_ACTIONS)[number])) {
    return { error: `unhandled email_action_type "${action}"` };
  }

  return { email, code, action };
}

/**
 * The code goes first, because the subject is the whole notification.
 *
 * A lock screen shows the subject and drops the body, and iOS reads a code out of
 * the subject line to offer it above the keyboard. "Your sign-in link" makes
 * somebody open the mail app to learn a number that could have been on the
 * banner.
 */
export function authCodeSubject(code: string, appName: string): string {
  return `${code} is your ${appName} sign-in code`;
}

/** The plain text part, written rather than derived. */
export function authCodeText(code: string, appName: string, appUrl: string): string {
  return [
    `Your ${appName} sign-in code is ${code}`,
    '',
    'Type it into the tab or the app you asked from.',
    'It expires in an hour and works once.',
    '',
    `You asked to sign in to ${appName}. If that was not you, nothing has happened:`,
    'the code does nothing on its own and expires by itself.',
    '',
    `Open ${appName}: ${appUrl}`,
  ].join('\n');
}
