/**
 * The colours a project can wear.
 *
 * Built the same way the two ramps in `globals.css` are: lightness and chroma
 * are fixed and hue is the only variable, so eight dots read as one set rather
 * than eight unrelated colours. L 0.62 is the compromise the two themes force. A
 * project dot is a mark, never text, so it does not owe 4.5:1, but it does have
 * to stay visible on a near-black page and on a cream one, and the light ramp's
 * own note puts the ceiling for a non-text mark around there.
 *
 * Hexes rather than tokens, because the value is stored on the row and travels
 * through `.ics` export and every future report. A token name would resolve to a
 * different colour after any change to the ramp, and a project that quietly
 * changed colour is a project somebody stops recognising.
 *
 * All eight are inside sRGB at this lightness and chroma, checked before they
 * were written down.
 */
export const PROJECT_COLORS = [
  '#BD6D5C', // clay 33.5
  '#B0793A', // sand 67.6
  '#7F8F42', // olive 119.5
  '#4C996A', // moss 155
  '#06999A', // teal 195
  '#4A8CC1', // slate 245
  '#807DC3', // iris 285
  '#AA6EA4', // plum 330
] as const;

/** The schema's default, which every project created before this picker wears.
 *  Kept out of the set above: at lightness 0.716 it is paler than the rest and
 *  would read as the odd one out in a row of swatches. */
export const LEGACY_PROJECT_COLOR = '#C29B72';

/**
 * A colour for a project nobody picked one for.
 *
 * Quick-add writes `@kitchen` and never opens the editor, so without this every
 * project made that way would be the same beige and the dots would identify
 * nothing. Rotating on the count already in the store spreads them without
 * needing to remember which was used last.
 */
export function swatchFor(index: number): string {
  return PROJECT_COLORS[Math.abs(index) % PROJECT_COLORS.length]!;
}
