import type { MetadataRoute } from 'next';
import { APP_NAME, APP_TAGLINE } from '@/lib/config';

/**
 * The web app manifest, which is what turns a tab into an installed app.
 *
 * Two icon purposes, because they are drawn differently and one cannot stand in
 * for the other. `any` keeps the squircle the mark was designed with. `maskable`
 * is full bleed with the ink pulled inside the launcher's 80% safe circle, so
 * Android can crop it to a circle, a rounded square or a teardrop without
 * clipping the letter. Both come out of `node brand/gen-icons.mjs`.
 *
 * `start_url` is `/today` rather than `/`, so launching from the home screen
 * skips the redirect that the root page does.
 *
 * iOS reads almost none of this. It takes the icon from `app/apple-icon.png` and
 * the standalone behaviour from the `apple-mobile-web-app-capable` meta tag in
 * the root layout. The manifest still matters there for one thing: adding to the
 * Home Screen is what gives Safari a `PushManager`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable identity, so a later change to start_url does not read as a
    // second app that has to be installed again.
    id: '/',
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    // --color-void in the dark ramp, matching the theme-color tag the layout
    // renders, so the splash screen and the app paint the same floor. The
    // manifest cannot follow the theme setting: it is read once at install.
    background_color: '#111316',
    theme_color: '#111316',
    orientation: 'portrait',
    categories: ['productivity'],
    // Send a tapped in-scope link to the installed app instead of a browser tab.
    // Chromium honours this; iOS has nothing equivalent and no API to ask for
    // one, which is why sign-in is a code rather than a link. Not in Next's
    // Manifest type yet, hence the widening.
    handle_links: 'preferred',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // Long-press the installed icon. Two entries, because a launcher shows four
    // at most and a list of every view is a menu rather than a shortcut.
    shortcuts: [
      { name: 'Today', short_name: 'Today', url: '/today' },
      { name: 'Inbox', short_name: 'Inbox', url: '/inbox' },
    ],
  } as MetadataRoute.Manifest;
}
