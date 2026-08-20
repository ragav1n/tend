import type { Metadata, Viewport } from 'next';
import { APP_NAME, APP_TAGLINE } from '@/lib/config';
import { THEME_SCRIPT } from '@/lib/theme';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { fontVariables } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    // black-translucent lets the app paint under the status bar, which is what
    // makes the safe-area padding in globals.css necessary rather than optional.
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false, date: false, address: false, email: false },
  // A personal task app has nothing to gain from being indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Required for env(safe-area-inset-*) to report real values on a notched
  // iPhone in standalone mode.
  viewportFit: 'cover',
  // Resize the visual viewport when the keyboard opens rather than panning it,
  // so a focused quick-add field stays put instead of sliding off screen.
  interactiveWidget: 'resizes-visual',
  // No themeColor here on purpose: the inline script owns that tag outright.
  colorScheme: 'dark light',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning because the script below writes data-theme onto
    // this element before React ever sees it, which is the point: the alternative
    // is a frame of the wrong ramp on every cold load.
    <html lang="en" className={fontVariables} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Before the first paint, so the page never flashes the other theme.
            A module import would land after the first frame.

            It writes the theme-color tag as well as the attribute, and creates
            that tag rather than editing one rendered here. React re-inserts a
            head tag it manages as soon as this changes it, which leaves two
            that disagree. The reasoning is in lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
