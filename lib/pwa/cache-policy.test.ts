import { describe, expect, it } from 'vitest';
import { classify, type CacheRule } from './cache-policy';

/**
 * The service worker's caching rules, as a table.
 *
 * The first block is the one that earns this file. Everything under it is a
 * request that must never reach a cache, and each case is a way that could
 * happen by accident: a sync POST looking like any other same-origin fetch, a
 * magic link callback looking like a navigation, a Supabase read looking like a
 * cross-origin GET. `app/sw.ts` is bundled by esbuild and runs in a scope no test
 * can reproduce, so this is the only place the rules can be held.
 */

const ORIGIN = 'https://tend-iota-jade.vercel.app';

function ruleFor(
  href: string,
  { rsc = false, navigation = false }: { rsc?: boolean; navigation?: boolean } = {},
): CacheRule {
  const url = new URL(href, ORIGIN);
  return classify({
    url,
    sameOrigin: url.origin === ORIGIN,
    isRsc: rsc,
    isNavigation: navigation,
  });
}

describe('nothing carrying a session is cached', () => {
  it('refuses both sync routes', () => {
    expect(ruleFor('/api/sync/push')).toBe('private');
    expect(ruleFor('/api/sync/pull')).toBe('private');
  });

  it('refuses every api route, named or not', () => {
    expect(ruleFor('/api/cron/reminders')).toBe('private');
    expect(ruleFor('/api/email/unsubscribe?token=abc')).toBe('private');
    expect(ruleFor('/api/something/added/later')).toBe('private');
    // The update check reads this one. A cached answer would report the
    // version of whichever deployment was live when the tab last loaded,
    // which is the exact question it exists to answer.
    expect(ruleFor('/api/version')).toBe('private');
  });

  it('refuses the auth callbacks, whose URLs carry a single-use code', () => {
    expect(ruleFor('/auth/callback?code=pkce-verifier')).toBe('private');
    expect(ruleFor('/auth/confirm?token_hash=abc')).toBe('private');
  });

  it('refuses Supabase whatever the subdomain', () => {
    expect(ruleFor('https://abcdefgh.supabase.co/rest/v1/tasks')).toBe('private');
    expect(ruleFor('https://abcdefgh.supabase.co/auth/v1/token')).toBe('private');
  });

  it('holds when a private request also looks like something cacheable', () => {
    // A navigation to the auth callback is exactly what a magic link is, and
    // caching that page would cache the code in its URL.
    expect(ruleFor('/auth/callback?code=abc', { navigation: true })).toBe('private');
    expect(ruleFor('/api/sync/pull', { rsc: true })).toBe('private');
    expect(ruleFor('https://abcdefgh.supabase.co/rest/v1/tasks', { navigation: true })).toBe(
      'private',
    );
  });
});

describe('the shell', () => {
  it('treats hashed build output as immutable', () => {
    expect(ruleFor('/_next/static/chunks/abc123.js')).toBe('immutable');
    expect(ruleFor('/_next/static/chunks/abc123.css')).toBe('immutable');
    // next/font self-hosts the font files under the same prefix, which is why
    // there is no separate rule for them.
    expect(ruleFor('/_next/static/media/instrument-serif.woff2')).toBe('immutable');
  });

  it('does not treat the rest of /_next as immutable', () => {
    // Only /_next/static is content-hashed. /_next/image is a live transform.
    expect(ruleFor('/_next/image?url=%2Ficons%2Ficon-192.png&w=64&q=75')).toBe('passthrough');
  });

  it('separates a navigation from the payload of a client-side one', () => {
    expect(ruleFor('/today', { navigation: true })).toBe('navigation');
    // Same URL, different response. They cannot share a cache key.
    expect(ruleFor('/today', { rsc: true })).toBe('rsc');
    expect(ruleFor('/today', { rsc: true, navigation: true })).toBe('rsc');
  });
});

describe('everything else', () => {
  it('passes through a request with no rule of its own', () => {
    // Precached at install, so it never needs a runtime rule.
    expect(ruleFor('/icons/icon-192.png')).toBe('passthrough');
    expect(ruleFor('/manifest.webmanifest')).toBe('passthrough');
  });

  it('passes through a third party rather than guessing', () => {
    expect(ruleFor('https://fonts.googleapis.com/css2?family=X')).toBe('passthrough');
    expect(ruleFor('https://example.com/anything')).toBe('passthrough');
  });

  it('does not mistake a lookalike host for Supabase', () => {
    expect(ruleFor('https://supabase.co.evil.example/rest/v1/tasks')).toBe('passthrough');
  });
});
