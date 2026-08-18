import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSendable, resolveMode, rewriteRecipient } from './mode';

/**
 * The guards. Six of them, because the failure they prevent is mailing a real
 * person from a laptop and there is no undo for that.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the default', () => {
  it('is off anywhere that is not a production deployment', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EMAIL_MODE', '');
    expect(resolveMode()).toBe('off');
  });

  it('is live in production, so a missing variable does not silence reminders', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('EMAIL_MODE', '');
    expect(resolveMode()).toBe('live');
  });

  it('refuses a mode it does not recognise rather than guessing', () => {
    vi.stubEnv('EMAIL_MODE', 'yes');
    expect(() => resolveMode()).toThrow(/EMAIL_MODE must be one of/);
  });
});

describe('live outside production', () => {
  it('is refused, because that is the mistake that actually happens', () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('EMAIL_MODE', 'live');
    vi.stubEnv('EMAIL_ALLOW_LIVE', '');
    expect(() => resolveMode()).toThrow(/outside a production deployment/);
  });

  it('is allowed when somebody says so explicitly', () => {
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('EMAIL_MODE', 'live');
    vi.stubEnv('EMAIL_ALLOW_LIVE', 'true');
    expect(resolveMode()).toBe('live');
  });
});

describe('catchall', () => {
  it('rewrites the recipient and keeps the original in the subject', () => {
    vi.stubEnv('EMAIL_DEV_INBOX', 'dev@example.com');
    expect(rewriteRecipient('real@person.com', 'Today: 3 tasks', 'catchall')).toEqual({
      to: 'dev@example.com',
      subject: '[real@person.com] Today: 3 tasks',
    });
  });

  it('will not run without an inbox to catch into', () => {
    vi.stubEnv('EMAIL_DEV_INBOX', '');
    expect(() => rewriteRecipient('real@person.com', 'x', 'catchall')).toThrow(
      /EMAIL_DEV_INBOX/,
    );
  });

  it('leaves the recipient alone in every other mode', () => {
    expect(rewriteRecipient('real@person.com', 'x', 'live')).toEqual({
      to: 'real@person.com',
      subject: 'x',
    });
  });
});

describe('the allowlist', () => {
  it('blocks an address this environment has no business writing to', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EMAIL_ALLOWED_DOMAINS', 'example.com');
    expect(() => assertSendable('someone@gmail.com', 'live')).toThrow(/refusing to send/);
    expect(() => assertSendable('me@example.com', 'live')).not.toThrow();
  });

  it('blocks everything when the list is empty', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EMAIL_ALLOWED_DOMAINS', '');
    expect(() => assertSendable('me@example.com', 'live')).toThrow(/currently empty/);
  });

  it('does not apply in production, where the addresses are the real ones', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('EMAIL_ALLOWED_DOMAINS', '');
    expect(() => assertSendable('someone@gmail.com', 'live')).not.toThrow();
  });

  it('has nothing to check when nothing is being sent', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('EMAIL_ALLOWED_DOMAINS', '');
    expect(() => assertSendable('someone@gmail.com', 'console')).not.toThrow();
  });
});
