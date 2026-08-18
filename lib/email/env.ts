/**
 * Where the app lives and who mail comes from.
 *
 * Read through functions rather than as module constants, because a route handler
 * importing this must not throw at build time over a variable that only matters
 * at send time.
 */

/** The public origin, used for every link in an email. */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  // Vercel exposes the production domain to every environment, which is what
  // links in an email should point at even from a preview deploy.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:3000';
}

/**
 * The From address.
 *
 * `onboarding@resend.dev` is Resend's shared sender and it only delivers to the
 * address that owns the Resend account, which makes it a natural sandbox. Moving
 * to a real domain is this one variable plus the DNS records.
 */
export function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || 'Tend <onboarding@resend.dev>';
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
