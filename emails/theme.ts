/**
 * The email palette, which is deliberately not the app's.
 *
 * The app is dark. Email has no dark surface to work against: Outlook.com and the
 * Gmail app force-invert whatever you send, so a design that depends on a dark
 * background arrives as mush. This is a light design that survives inversion, and
 * every table cell carries an explicit background because an unstyled cell is the
 * one that inverts.
 *
 * Beige is a background only. Beige on white measures 2.1:1, which is unusable
 * for text and fine for a rule or a chip.
 */
export const email = {
  page: '#FAF7F2',
  surface: '#FFFFFF',
  // Never pure black: it triggers the most aggressive client inversion.
  text: '#2B2D31',
  textSoft: '#5B5F66',
  heading: '#3A4027',
  rule: '#E4DAC9',
  chip: '#C29B72',
  action: '#8D321F',
  actionText: '#FFF8F0',
} as const;

/**
 * Full stacks, because a webfont silently fails in Outlook and the fallback is
 * what most readers see anyway.
 */
export const fonts = {
  body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
} as const;

export const WIDTH = 600;
