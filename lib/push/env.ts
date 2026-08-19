import { appUrl } from '@/lib/email/env';

/**
 * The VAPID identity, which is what lets a push service accept a message from
 * this server on behalf of a browser that subscribed to it.
 *
 * Read through a function rather than as module constants, and answering null
 * rather than throwing when it is unset. Push is additive: an install with no
 * keys should send email exactly as it did before, not fail its cron run. That is
 * the same shape as the email guards, where a missing key means "off" rather than
 * "crash".
 *
 * The public key is deliberately the NEXT_PUBLIC_ one and is read here too. It is
 * public by definition, the browser needs it to subscribe, and a second copy for
 * the server would be one more value to keep in step for no benefit.
 *
 * Generate a pair with `npx web-push generate-vapid-keys`. Rotating them
 * invalidates every existing subscription, so every device has to be re-enabled.
 */

export interface Vapid {
  publicKey: string;
  privateKey: string;
  /** A mailto: or https: URL a push service can use to contact the operator. */
  subject: string;
}

export function vapid(): Vapid | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;

  return {
    publicKey,
    privateKey,
    // The spec wants a way to reach whoever is sending. The app's own origin
    // qualifies and needs no extra variable to be correct.
    subject: process.env.VAPID_SUBJECT?.trim() || appUrl(),
  };
}
