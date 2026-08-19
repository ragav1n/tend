/**
 * Rasterises every icon the app ships from the one mark in lib/brand.ts.
 *
 * Run it by hand after changing the mark or the clay ramp:
 *
 *   node brand/gen-icons.mjs
 *
 * It is a tool, not a build step, so the PNGs are committed and nothing in the
 * app imports this file. It borrows sharp and jiti from the installed tree
 * rather than declaring them, because they arrive with next and with the eslint
 * config already and adding them to package.json would mean a lockfile the
 * build has no reason to carry. If either one ever goes missing this script
 * stops running and the committed icons carry on working; `npm i -D sharp jiti`
 * puts it back.
 *
 * Nothing here hardcodes a colour. The tile and the ink are token names that
 * get resolved out of app/globals.css, so re-running this after a ramp change
 * moves the app icon with it.
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jiti = createJiti(import.meta.url);

const {
  MARK_BAR,
  MARK_SIZE,
  MARK_STEM,
  MARK_TILE_TOKEN,
  MARK_INK_TOKEN,
  INK_FRACTION,
  INK_FRACTION_MASKABLE,
  TILE_RADIUS_RATIO,
} = await jiti.import(join(ROOT, 'lib/brand.ts'));
const { extractColorTokens, oklchToHex } = await jiti.import(join(ROOT, 'lib/color.ts'));

const tokens = extractColorTokens(readFileSync(join(ROOT, 'app/globals.css'), 'utf8'));
const hex = (name) => {
  const token = tokens[name];
  if (!token) throw new Error(`--color-${name} is missing from app/globals.css`);
  return oklchToHex(token);
};
const TILE = hex(MARK_TILE_TOKEN);
const INK = hex(MARK_INK_TOKEN);

/** The ink is 78 units tall on the 96 grid, so scale from that, not the grid. */
const INK_HEIGHT = 78;

/**
 * One tile. `radius` of 0 gives the full-bleed square a launcher expects to
 * mask itself; anything else gets the squircle browsers and iOS show as-is.
 */
function tile({ size, inkFraction = INK_FRACTION, radius = size * TILE_RADIUS_RATIO, bg = TILE }) {
  const scale = (inkFraction * size) / INK_HEIGHT;
  const half = MARK_SIZE / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(${-half} ${-half})" fill="${INK}">
    <path d="${MARK_STEM}"/>
    <path d="${MARK_BAR}"/>
  </g>
</svg>`;
}

/**
 * Density renders the SVG larger than its nominal size rather than sharper, so
 * every call resizes back down. That supersample is what keeps the crossbar's
 * angled cut clean at 16px.
 *
 * `flatten` drops the alpha channel for the full-bleed icons, where iOS and the
 * Android launcher supply the mask and a transparent corner is only weight.
 */
async function png(svg, size, { flatten = false } = {}) {
  let pipeline = sharp(Buffer.from(svg), { density: 384 }).resize(size, size);
  if (flatten) pipeline = pipeline.flatten({ background: TILE });
  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

/**
 * ICO with PNG payloads, which every browser and Windows since Vista reads.
 * sharp cannot write the container, and it is only a header plus one directory
 * entry per size, so it is packed here rather than pulling in a dependency.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  for (const [i, { size, data }] of images.entries()) {
    const at = 16 * i;
    entries.writeUInt8(size >= 256 ? 0 : size, at);
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1);
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(data.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += data.length;
  }
  return Buffer.concat([header, entries, ...images.map((i) => i.data)]);
}

function write(path, data) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  console.log(`  ${path}  ${(data.length / 1024).toFixed(1)}kB`);
}

console.log(`mark on ${TILE}, ink ${INK}`);

// Browser tab and the Next icon convention. Rounded, with the corners left
// transparent so the tile reads as a tile on light and dark browser chrome.
write('app/icon.png', await png(tile({ size: 512 }), 512));
write(
  'app/favicon.ico',
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({
        size,
        // Small sizes lose the crossbar to antialiasing before they lose the
        // corners, so the radius tightens rather than the ink shrinking.
        data: await png(tile({ size, radius: size * 0.18 }), size),
      })),
    ),
  ),
);

// iOS masks the home screen icon itself, so it gets a full-bleed square.
write('app/apple-icon.png', await png(tile({ size: 180, radius: 0 }), 180, { flatten: true }));

// The manifest set phase 3 needs. "any" keeps its own corners, "maskable" goes
// full bleed and pulls the ink inside the launcher's 80% safe circle.
for (const size of [192, 512]) {
  write(`public/icons/icon-${size}.png`, await png(tile({ size }), size));
  write(
    `public/icons/maskable-${size}.png`,
    await png(tile({ size, radius: 0, inkFraction: INK_FRACTION_MASKABLE }), size, {
      flatten: true,
    }),
  );
}

// Email. Outlook.com and the Gmail app invert what they are sent, and a
// transparent PNG loses its corners against the inverted background, so this
// one is flattened onto the email surface and ships no alpha at all.
const EMAIL_SURFACE = '#FFFFFF';
write(
  'public/email/mark.png',
  await sharp(Buffer.from(tile({ size: 72 })), { density: 384 })
    .resize(72, 72)
    .flatten({ background: EMAIL_SURFACE })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
