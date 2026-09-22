/**
 * Renders docs/using-tend.md to a styled HTML page and a PDF.
 *
 *   node docs/build-doc.mjs
 *
 * The markdown is the source. This exists so the handout cannot drift from it,
 * the same reason the icons are generated from `lib/brand.ts` rather than drawn
 * twice. Colours are the light ramp out of `app/globals.css`: paper is warm and
 * never pure white, clay carries interaction, olive carries state.
 *
 * The PDF comes from headless Chrome because it is already on the machine and
 * it is the same engine the app is designed against, so a table that lays out
 * in the browser lays out on the page.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find(existsSync);

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const md = readFileSync(join(HERE, 'using-tend.md'), 'utf8');

// The first heading becomes the cover, so it is dropped from the flow.
const body = marked.parse(md.replace(/^# .*\n/, ''), { mangle: false, headerIds: true });

const today = new Date().toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Using Tend</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --void:#F8F4EF; --surface:#FFFDFB; --raised:#EFE9E4; --sunken:#EBE4DD;
  --clay-600:#8D321F; --clay-300:#9F422F; --clay-200:#882D1A;
  --olive-600:#505935; --olive-300:#5C6541;
  --sand-300:#7F5B33;
  --text-hi:#241D15; --text-mid:#594E42; --text-lo:#6E6152;
  --line:#E2D9D0; --on-accent:#F7F0E9;
}
@page { size: letter; margin: 17mm 16mm 18mm; }
* { box-sizing:border-box; }
html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
/* The page itself stays white. Chrome never paints a page's margin area, so a
   tinted body came out as a cream block floating in a white frame on every
   sheet. The warmth lives in the blocks instead, which is the right call for
   paper anyway: less ink, and a code sample reads as an object on the page
   rather than as a slightly different shade of the page. */
body {
  margin:0; color:var(--text-mid);
  font-family:'Instrument Sans',ui-sans-serif,system-ui,sans-serif;
  font-size:10.2pt; line-height:1.62; font-feature-settings:'ss01','cv01';
}
.page { max-width:none; }

/* ── Cover ─────────────────────────────────────────────────────────────── */
.cover { page-break-after:always; padding-top:46mm; }
.mark {
  display:inline-grid; place-items:center; width:46px; height:46px;
  border-radius:11px; background:var(--clay-600); color:var(--on-accent);
  font-family:'Instrument Serif',serif; font-size:27px; line-height:1;
  padding-bottom:3px; margin-bottom:26px;
}
.cover h1 {
  font-family:'Instrument Serif',serif; font-weight:400;
  font-size:56pt; line-height:0.98; letter-spacing:-0.015em;
  color:var(--text-hi); margin:0 0 14px;
}
.cover .sub { font-size:13pt; color:var(--text-lo); margin:0 0 40px; max-width:110mm; }
.cover .meta {
  border-top:1px solid var(--line); padding-top:14px;
  font-family:'JetBrains Mono',ui-monospace,monospace; font-size:8pt;
  letter-spacing:0.08em; text-transform:uppercase; color:var(--text-lo);
  display:flex; gap:26px; flex-wrap:wrap;
}
.cover .meta b { color:var(--clay-300); font-weight:500; }

/* ── Headings ──────────────────────────────────────────────────────────── */
h2 {
  font-family:'Instrument Serif',serif; font-weight:400; font-size:23pt;
  line-height:1.12; color:var(--text-hi);
  margin:30px 0 11px; padding-bottom:7px; border-bottom:1px solid var(--line);
  page-break-after:avoid;
}
h3 {
  font-size:11.5pt; font-weight:600; color:var(--clay-300);
  margin:20px 0 7px; page-break-after:avoid;
}
h2 + h3 { margin-top:12px; }
p { margin:0 0 10px; }
a { color:var(--clay-300); text-decoration:none; border-bottom:1px solid #E6CFC7; }

/* ── Lists ─────────────────────────────────────────────────────────────── */
ul,ol { margin:0 0 12px; padding-left:19px; }
li { margin:0 0 5px; padding-left:2px; }
li::marker { color:var(--sand-300); }
ul ul, ol ol, ul ol, ol ul { margin:5px 0 0; }

/* ── Code ──────────────────────────────────────────────────────────────── */
code {
  font-family:'JetBrains Mono',ui-monospace,monospace; font-size:0.845em;
  background:#F1E9E2; color:var(--clay-200);
  padding:1.5px 5px; border-radius:4px; white-space:nowrap;
}
pre {
  background:var(--void); border:1px solid var(--line);
  border-left:3px solid var(--clay-600);
  border-radius:7px; padding:11px 14px; margin:0 0 13px;
  overflow:hidden; page-break-inside:avoid;
}
pre code {
  background:none; padding:0; color:var(--text-hi);
  font-size:8.9pt; line-height:1.55; white-space:pre-wrap; word-break:break-word;
}

/* ── Tables ────────────────────────────────────────────────────────────── */
table {
  width:100%; border-collapse:collapse; margin:0 0 14px;
  font-size:9.3pt; page-break-inside:avoid;
  border:1px solid var(--line); border-radius:7px; overflow:hidden;
}
thead { background:#F1EAE3; }
th {
  text-align:left; font-size:7.6pt; font-weight:600; letter-spacing:0.09em;
  text-transform:uppercase; color:var(--text-lo);
  padding:8px 11px; border-bottom:1px solid var(--line);
}
td { padding:7px 11px; border-bottom:1px solid var(--line); vertical-align:top; color:var(--text-mid); }
tbody tr:last-child td { border-bottom:none; }
tbody tr:nth-child(even) { background:#FAF6F2; }
td code { white-space:normal; }
td:first-child { color:var(--text-hi); }

strong { color:var(--text-hi); font-weight:600; }
hr { border:none; border-top:1px solid var(--line); margin:26px 0; }
blockquote {
  margin:0 0 13px; padding:2px 0 2px 14px;
  border-left:3px solid var(--olive-600); color:var(--text-lo);
}
h2,h3,table,pre { break-inside:avoid; }
</style>
</head>
<body>
<section class="cover">
  <div class="mark">t</div>
  <h1>Using&nbsp;Tend</h1>
  <p class="sub">Every feature, the quick-add syntax, setting up a semester, Canvas import and the local model assist.</p>
  <div class="meta">
    <span>Version <b>${version}</b></span>
    <span>${today}</span>
    <span>tend-iota-jade.vercel.app</span>
  </div>
</section>
<main class="page">
${body}
</main>
</body>
</html>`;

const htmlPath = join(HERE, 'using-tend.html');
writeFileSync(htmlPath, html);
console.log('wrote', htmlPath);

if (!CHROME) {
  console.error('No Chrome found, so the PDF was skipped. The HTML prints fine by hand.');
  process.exit(0);
}

const pdfPath = join(HERE, 'using-tend.pdf');
execFileSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-pdf-header-footer',
  '--virtual-time-budget=12000',
  `--print-to-pdf=${pdfPath}`,
  `file://${htmlPath}`,
], { stdio: 'pipe' });
console.log('wrote', pdfPath);
