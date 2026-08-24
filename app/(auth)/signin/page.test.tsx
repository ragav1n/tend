// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignInPage from './page';

/**
 * The sign-in form asks for a code, not a click.
 *
 * Held in a test because the tempting simplification is to go back to "check
 * your email": it is less markup and it reads fine on a laptop. On the phone it
 * is a dead end, since the link opens the browser and the browser is not the
 * installed app. These cases are the shape that works there.
 */

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ auth: { signInWithOtp, verifyOtp, signInWithOAuth: vi.fn() } }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const replace = vi.fn();

beforeEach(() => {
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  replace.mockReset();
  // jsdom refuses an assignment to location, so the one method used gets stubbed.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://tend.test', replace },
  });
});

afterEach(cleanup);

/** Ask for a code, the way somebody arriving at this page does. */
async function requestCode() {
  render(<SignInPage />);
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'a@b.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: /email me a code/i }));
  return waitFor(() => screen.getByLabelText('Code'));
}

describe('sign in', () => {
  it('asks for a code rather than telling you to check your email', async () => {
    const field = await requestCode();

    expect(field).toBeTruthy();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy();
    // The link still goes out, for a browser reading its own email.
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      options: { emailRedirectTo: 'https://tend.test/auth/callback?next=/today' },
    });
  });

  it('holds the button until the code reaches the shortest one Supabase mints', async () => {
    const field = await requestCode();
    const submit = screen.getByRole('button', { name: /^sign in$/i });

    expect(submit).toHaveProperty('disabled', true);

    fireEvent.change(field, { target: { value: '123' } });
    expect(submit).toHaveProperty('disabled', true);

    fireEvent.change(field, { target: { value: '123456' } });
    expect(submit).toHaveProperty('disabled', false);
  });

  /**
   * The regression, at the level somebody actually hit it.
   *
   * A project set to eight digits mails eight. The field used to keep six, so the
   * code in the email was unusable and the only symptom was Supabase saying the
   * token was invalid, which points at everything except the real cause.
   */
  it('keeps all eight digits when the project issues eight', async () => {
    const field = await requestCode();

    fireEvent.change(field, { target: { value: '48291573' } });
    expect(field).toHaveProperty('value', '48291573');

    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/today'));
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      token: '48291573',
      type: 'email',
    });
  });

  it('promises nothing about the length, since it cannot read the setting', async () => {
    await requestCode();

    // No placeholder saying 000000, and no copy saying six.
    expect(screen.getByLabelText('Code')).toHaveProperty('placeholder', '');
    expect(document.body.textContent).not.toMatch(/six digits/i);
  });

  it('verifies in this browsing context and then reloads into the app', async () => {
    const field = await requestCode();

    fireEvent.change(field, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/today'));
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      token: '123456',
      type: 'email',
    });
  });

  it('keeps you on the code step when the code is wrong', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    const field = await requestCode();

    fireEvent.change(field, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toContain('expired or is invalid');
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Code')).toBeTruthy();
  });
});
