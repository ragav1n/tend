import type { Metadata, Viewport } from 'next';
import { APP_NAME, APP_TAGLINE } from '@/lib/config';
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
  // Matches --color-void so the iOS status bar and Android chrome blend into
  // the page instead of banding against it.
  themeColor: '#111316',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
