/**
 * The Tend mark.
 *
 * A lowercase serif "t" drawn for this app rather than set in a typeface. Three
 * decisions carry the whole idea. The ascender is sheared along the same
 * top-left light every elevation token in globals.css assumes, so the mark is
 * made of the same material as the cards. The foot lifts off the baseline and
 * its terminal is cut at an angle, so the letter reads as something still
 * growing rather than something stopped. The crossbar repeats that cut at both
 * ends, which is the only place the two shapes agree.
 *
 * Lowercase, because "look after what needs doing" is not a capital-letter
 * sentiment. A tick was drawn and rejected: every task app owns one, and the
 * versions that hid a tick inside the letter stopped reading as a "t" at 16px.
 *
 * Both paths sit on a 96x96 grid with the ink optically centred, and this is
 * their only copy. components/brand/Mark.tsx draws them, brand/gen-icons.mjs
 * rasterises every PNG from them, and lib/brand.test.ts holds the centring so
 * an edit to one path cannot quietly push the mark off axis.
 */

/** The stem, the turn and the lifting foot, as one closed outline. */
export const MARK_STEM =
  'M30.5 15 L46.5 9 L46.5 57 ' +
  'C46.5 70 51.5 75 59.5 75 ' +
  'C67.5 75 71.5 68 73.5 59 ' +
  'L81.5 62 ' +
  'C78.5 79 70.5 87 59.5 87 ' +
  'C27.5 87 30.5 69 30.5 61 Z';

/** The crossbar, cut at the same angle as the ascender. */
export const MARK_BAR = 'M17.5 31 L69.5 31 L66.5 42 L14.5 42 Z';

/** The grid both paths are drawn on. */
export const MARK_SIZE = 96;

/**
 * The mark is drawn in tokens, never in hex. The React components reach them
 * through Tailwind and the icon generator resolves them out of globals.css, so
 * a change to the ramp reaches the app icon too.
 *
 * text-hi on clay-600 measures 7.16:1, which is why the fill can be a 600 step
 * here when globals.css calls the 600s fills-only: the ink on top clears AA.
 */
export const MARK_TILE_TOKEN = 'clay-600';
export const MARK_INK_TOKEN = 'text-hi';

/**
 * How much of a tile the mark's ink fills. A maskable icon is cropped to the
 * centred circle of 80% diameter by the launcher, so it gets the smaller share
 * and everything else gets the larger one.
 */
export const INK_FRACTION = 0.62;
export const INK_FRACTION_MASKABLE = 0.48;

/** Corner radius as a share of the tile, matching the iOS squircle. */
export const TILE_RADIUS_RATIO = 0.225;
