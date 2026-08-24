import { describe, expect, it } from 'vitest';
import { authCodeSubject, authCodeText, readAuthHook } from './auth-code';

/**
 * The hook's payload reading, which is the only place a malformed post can be
 * caught before somebody is left waiting on an email.
 *
 * Every rejection here has to be a rejection rather than a quiet default: the
 * route answers Supabase with a status, and a 200 over a missing token tells it
 * the code was sent.
 */

function payload(over: Record<string, unknown> = {}) {
  return {
    user: { email: 'me@example.com' },
    email_data: { token: '482915', email_action_type: 'magiclink' },
    ...over,
  };
}

describe('readAuthHook', () => {
  it('reads a returning user', () => {
    expect(readAuthHook(payload())).toEqual({
      email: 'me@example.com',
      code: '482915',
      action: 'magiclink',
    });
  });

  it('reads a first ever sign-in, which arrives as a signup', () => {
    const hook = readAuthHook(
      payload({ email_data: { token: '111222', email_action_type: 'signup' } }),
    );
    expect(hook).toEqual({ email: 'me@example.com', code: '111222', action: 'signup' });
  });

  it('refuses an action type this app has no screen for', () => {
    for (const action of ['recovery', 'email_change', 'invite', 'reauthentication', '']) {
      const hook = readAuthHook(
        payload({ email_data: { token: '482915', email_action_type: action } }),
      );
      expect(hook).toHaveProperty('error');
    }
  });

  it('refuses a payload with no token, rather than mailing an empty box', () => {
    expect(readAuthHook(payload({ email_data: { email_action_type: 'magiclink' } })))
      .toHaveProperty('error');
  });

  it('refuses a payload with no address', () => {
    expect(readAuthHook(payload({ user: {} }))).toHaveProperty('error');
    expect(readAuthHook({})).toHaveProperty('error');
    expect(readAuthHook(null)).toHaveProperty('error');
  });
});

describe('authCodeSubject', () => {
  it('puts the code first, because the subject is the whole notification', () => {
    expect(authCodeSubject('482915', 'Tend')).toBe('482915 is your Tend sign-in code');
  });

  it('starts with the digits, so a lock screen shows them before it truncates', () => {
    expect(authCodeSubject('482915', 'Tend').startsWith('482915')).toBe(true);
  });
});

describe('authCodeText', () => {
  it('carries the code and no unsubscribe link', () => {
    const text = authCodeText('482915', 'Tend', 'https://tend.test');
    expect(text).toContain('482915');
    expect(text).toContain('https://tend.test');
    expect(text.toLowerCase()).not.toContain('unsubscribe');
    expect(text.toLowerCase()).not.toContain('turn these off');
  });
});
