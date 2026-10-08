// DR/WipEout share card (1200x630) from a real in-game frame.
// Usage: node scripts/og/compose-game-card.mjs <rally|city> <frame.png> <out.jpg> [--side=left|right] [--font=dirt] [--zoom=1.1] [--fx=0.5] [--fy=0.5]
// Frames are captured from `pnpm dev` with the HUD hidden (kept in .private/og-drafts, never committed).
// Rally titles use a bundled OFL font (scripts/og/fonts) with skew, speed streaks, grunge and misregistration.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import opentype from 'opentype.js';

const args = process.argv.slice(2);
const [game, frame, out] = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const W = 1200, H = 630;
const RED = '#ff2a2a', INK = '#0a0a0c', WHITE = '#ffffff';
const FONTS = {
  dirt: { file: 'RubikDirt-Regular.ttf', family: 'Rubik Dirt' },
};

const CARDS = {
  rally: { title: ['TOKEN', 'RALLY'], accent: '#ffb000', tag: 'EVERY LITRE OF FUEL IS A BSV TX', sub: 'LIVE · MULTIPLAYER', code: 'TB-RLY/02 · STAGE 1 MAINNET PINES', extra: 'RIVALS = LIVE MAINNET TXS', grunge: true },
  city: { title: ['SATOSHI', 'CITY'], accent: '#22e6ff', tag: 'EVERY CAR IS A LIVE BSV TX', sub: 'OPEN WORLD · LIVE CHAIN', code: 'TB-CTY/02 · NIGHT SHIFT', extra: 'STEAL · DELIVER · RACE THE MEMPOOL', grunge: false },
};
const c = CARDS[game];
if (!c || !frame || !out) throw new Error('usage: compose-game-card.mjs <rally|city> <frame.png> <out.jpg> [--side=..] [--font=..] [--zoom=..] [--fx=..] [--fy=..]');
const left = (opt.side ?? 'left') === 'left';
const tx = left ? 54 : W - 54;
const anchor = left ? 'start' : 'end';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const COND = "Impact, 'Haettenschweiler', 'Arial Narrow Bold', sans-serif";
const MONO = "Menlo, 'Courier New', monospace";

// Seeded PRNG so the grunge is identical on every run.
let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const hazard = (x, y, w, h, a = c.accent) => {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${INK}"/>`;
  for (let i = -h; i < w; i += 28) s += `<polygon points="${x + i},${y + h} ${x + i + 14},${y + h} ${x + i + 14 + h},${y} ${x + i + h},${y}" fill="${a}"/>`;
  return `<g clip-path="url(#hz${x}${y})"><clipPath id="hz${x}${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>${s}</g>`;
};

function chrome(withTitle) {
  const [t1, t2] = c.title;
  const ts = 160;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="fade" x1="${left ? 0 : 1}" y1="0" x2="${left ? 1 : 0}" y2="0">
      <stop offset="0" stop-color="${INK}" stop-opacity="0.9"/><stop offset="0.4" stop-color="${INK}" stop-opacity="0.5"/><stop offset="0.68" stop-color="${INK}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="${INK}" stop-opacity="0"/><stop offset="1" stop-color="${INK}" stop-opacity="0.85"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <rect width="${W}" height="${H}" fill="url(#floor)"/>
  ${hazard(0, 0, W, 16)}
  <g transform="skewX(-18)">
    <rect x="${left ? 150 : W - 250}" y="16" width="34" height="${H - 76}" fill="${RED}" opacity="0.85"/>
    <rect x="${left ? 194 : W - 206}" y="16" width="12" height="${H - 76}" fill="${WHITE}" opacity="0.85"/>
  </g>
  <text x="${tx}" y="46" text-anchor="${anchor}" font-family="${MONO}" font-size="17" font-weight="700" fill="${c.accent}" letter-spacing="3">${esc(c.code)}</text>
  ${withTitle ? `<g font-family="${COND}" font-size="${ts}" text-anchor="${anchor}" letter-spacing="2">
    <text x="${tx + (left ? 6 : -6)}" y="${200 + 6}" fill="${RED}">${t1}</text>
    <text x="${tx}" y="200" fill="${WHITE}">${t1}</text>
    <text x="${tx + (left ? 6 : -6)}" y="${200 + ts * 0.92 + 6}" fill="${INK}">${t2}</text>
    <text x="${tx}" y="${200 + ts * 0.92}" fill="${RED}">${t2}</text>
  </g>` : ''}
  <g transform="translate(${left ? 54 : W - 54 - 560}, 424)">
    <rect width="560" height="50" fill="${WHITE}"/>
    <rect width="14" height="50" fill="${RED}"/>
    <text x="30" y="35" font-family="${COND}" font-size="31" fill="${INK}" letter-spacing="1.5">${esc(c.tag)}</text>
    <rect y="58" width="${c.sub.length * 17 + 36}" height="36" fill="${RED}"/>
    <text x="18" y="84" font-family="${MONO}" font-size="20" font-weight="700" fill="${WHITE}" letter-spacing="2">${esc(c.sub)}</text>
  </g>
  <rect x="0" y="${H - 44}" width="${W}" height="44" fill="${INK}"/>
  <rect x="0" y="${H - 44}" width="${W}" height="4" fill="${RED}"/>
  <text x="54" y="${H - 14}" font-family="${MONO}" font-size="18" font-weight="700" fill="${WHITE}" letter-spacing="2">TOKENBLASTER<tspan fill="${RED}">.LOL</tspan></text>
  <text x="${W - 54}" y="${H - 14}" text-anchor="end" font-family="${MONO}" font-size="15" fill="${c.accent}" letter-spacing="2">${esc(c.extra)} ▲▲▲</text>
</svg>`;
}

/** One word of the rally title as an RGBA buffer in the given colour (glyph outlines from the bundled font). */
const fontCache = {};
async function word(text, colour, size, font) {
  fontCache[font.file] ??= opentype.parse(readFileSync(new URL(`./fonts/${font.file}`, import.meta.url)).buffer);
  const f = fontCache[font.file];
  // Glyph by glyph (no shaping: Rubik Dirt's GSUB tables trip opentype.js).
  const path = new opentype.Path();
  let x = 0;
  for (const ch of text) {
    const g = f.charToGlyph(ch);
    path.extend(g.getPath(x, size, size));
    x += (g.advanceWidth / f.unitsPerEm) * size * 1.02;
  }
  const bb = path.getBoundingBox();
  const w = Math.ceil(bb.x2 - bb.x1) + 4, h = Math.ceil(bb.y2 - bb.y1) + 4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g transform="translate(${2 - bb.x1},${2 - bb.y1})"><path d="${path.toPathData(2)}" fill="${colour}"/></g></svg>`;
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/** Grunge mask: blotches + scratches, white = keep. */
async function grungeMask(w, h) {
  const n = Buffer.alloc(w * h, 255);
  // blotches
  for (let k = 0; k < (w * h) / 700; k++) {
    const x0 = rnd() * w, y0 = rnd() * h, r = 1 + rnd() * rnd() * 7;
    for (let y = Math.max(0, y0 - r) | 0; y < Math.min(h, y0 + r); y++)
      for (let x = Math.max(0, x0 - r) | 0; x < Math.min(w, x0 + r); x++) if ((x - x0) ** 2 + (y - y0) ** 2 < r * r) n[y * w + x] = 0;
  }
  // scratches (long thin diagonal-ish gouges)
  for (let k = 0; k < 26; k++) {
    let x = rnd() * w, y = rnd() * h;
    const a = -0.35 + rnd() * 0.25, len = 40 + rnd() * 220;
    for (let t = 0; t < len; t++) {
      x += Math.cos(a); y += Math.sin(a) + (rnd() - 0.5) * 0.6;
      const xi = x | 0, yi = y | 0;
      if (xi >= 0 && xi < w && yi >= 0 && yi < h) { n[yi * w + xi] = 0; if (yi + 1 < h) n[(yi + 1) * w + xi] = 0; }
    }
  }
  const rgba = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = n[i];
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).blur(0.6).png().toBuffer();
}

async function grungeTitle() {
  const font = FONTS[opt.font ?? 'dirt'];
  const size = 132;
  const SKEW = -0.26; // forward lean
  const lines = [];
  for (const [i, t] of c.title.entries()) {
    const colour = i === 0 ? WHITE : RED;
    const fg = await word(t, colour, size, font);
    const w = fg.info.width + 160, h = fg.info.height + 20;
    const pad = (buf, info) => sharp(buf, { raw: info }).extend({ left: 80, right: 80, top: 10, bottom: 10, background: { r: 0, g: 0, b: 0, alpha: 0 } }).raw().toBuffer();
    const skew = async (buf) =>
      sharp(buf, { raw: { width: w, height: h, channels: 4 } }).affine([[1, SKEW], [0, 1]], { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const base = await pad(fg.data, fg.info);
    const mis = await pad((await word(t, i === 0 ? c.accent : '#1fd5ff', size, font)).data, fg.info);
    const shadow = await pad((await word(t, INK, size, font)).data, fg.info);
    // grunge eats the face of the letters
    const mask = await grungeMask(w, h);
    const face = await sharp(base, { raw: { width: w, height: h, channels: 4 } }).composite([{ input: mask, blend: 'dest-in' }]).raw().toBuffer();
    // speed streaks: smear trailing to the left
    const kw = 121, kernel = Array.from({ length: kw }, (_, j) => (j > kw / 2 ? (1 - (j - kw / 2) / (kw / 2)) : 0));
    const ksum = kernel.reduce((a, b) => a + b, 0);
    const streak = await sharp(await pad((await word(t, i === 0 ? WHITE : RED, size, font)).data, fg.info), { raw: { width: w, height: h, channels: 4 } })
      .convolve({ width: kw, height: 3, kernel: [...Array(kw).fill(0), ...kernel.map((k) => k / ksum), ...Array(kw).fill(0)], scale: 1 })
      .raw().toBuffer();
    const sk = await Promise.all([streak, shadow, mis, face].map(skew));
    const layered = await sharp({ create: { width: (await sharp(sk[0]).metadata()).width, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: await sharp(sk[0]).linear([1, 1, 1, 0.5], [0, 0, 0, 0]).png().toBuffer(), left: -46, top: 4 },
        { input: await sharp(sk[0]).linear([1, 1, 1, 0.22], [0, 0, 0, 0]).png().toBuffer(), left: -110, top: 6 },
        { input: sk[1], left: 9, top: 8 },
        { input: sk[2], left: -5, top: -3 },
        { input: sk[3], left: 0, top: 0 },
      ])
      .png().toBuffer();
    lines.push(layered);
  }
  return lines;
}

const zoom = +(opt.zoom ?? 1);
const meta = await sharp(frame).metadata();
const scale = Math.max(W / meta.width, H / meta.height) * zoom;
const sw = Math.round(meta.width * scale), sh = Math.round(meta.height * scale);
const fx = +(opt.fx ?? 0.5), fy = +(opt.fy ?? 0.5);
const base = await sharp(frame)
  .resize(sw, sh)
  .extract({ left: Math.round((sw - W) * fx), top: Math.round((sh - H) * fy), width: W, height: H })
  .modulate({ saturation: 1.15 })
  .linear(1.08, -6)
  .toBuffer();

const layers = [{ input: Buffer.from(chrome(!c.grunge)) }];
if (c.grunge) {
  const [l1, l2] = await grungeTitle();
  const m1 = await sharp(l1).metadata(), m2 = await sharp(l2).metadata();
  const x1 = left ? 20 : W - m1.width + 20, x2 = left ? 0 : W - m2.width + 40;
  layers.push({ input: l1, left: Math.max(0, x1), top: 52 }, { input: l2, left: Math.max(0, x2), top: 52 + 150 });
}
await sharp(base).composite(layers)[out.endsWith('.png') ? 'png' : 'jpeg']({ quality: 82, mozjpeg: true }).toFile(out);
console.log('wrote', out);
