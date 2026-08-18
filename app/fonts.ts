import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google';

/**
 * Self-hosted through next/font, so they are served from our origin and work
 * with no network once the service worker has precached /_next/static/media.
 */

/** UI voice. Variable font, so one file covers every weight we use. */
export const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument-sans',
});

/**
 * Display voice: large headings, dates, the review screen. Instrument Serif is
 * not a variable font, so `weight` is required rather than optional.
 */
export const instrumentSerif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument-serif',
});

/** Instrument voice: counts, timers, key caps, uppercase labels. */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const fontVariables = [
  instrumentSans.variable,
  instrumentSerif.variable,
  jetbrainsMono.variable,
].join(' ');
