// DR/WipEout share card (1200x630) from a real in-game frame.
// Usage: node scripts/og/compose-game-card.mjs <rally|city> <frame.png> <out.jpg> [--side=left|right] [--font=<key>] [--zoom=1.1] [--fx=0.5] [--fy=0.5]
// Frames are captured from `pnpm dev` with the HUD hidden (kept in .private/og-drafts, never committed).
// Titles are glyph outlines from bundled OFL fonts (scripts/og/fonts), drawn as SVG paths:
//   rally: bold italic rally face, light edge wear, two speed streaks;  city: neon-tube glow.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import opentype from 'opentype.js';

const args = process.argv.slice(2);
const [game, frame, out] = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const W = 1200, H = 630;
const RED = '#ff2a2a', INK = '#0a0a0c', WHITE = '#ffffff';
const FONTS = {
  russo: 'RussoOne-Regular.ttf',
  saira: 'SairaCondensed-ExtraBold.ttf',
  michroma: 'Michroma-Regular.ttf',
  monoton: 'Monoton-Regular.ttf',
};

const CARDS = {
  rally: { title: ['TOKEN', 'RALLY'], font: 'russo', style: 'rally', accent: '#ffb000', tag: 'EVERY LITRE OF FUEL IS A BSV TX', sub: 'LIVE · MULTIPLAYER', code: 'TB-RLY/03 · STAGE 1 MAINNET PINES', extra: 'RIVALS = LIVE MAINNET TXS' },
  city: { title: ['SATOSHI', 'CITY'], font: 'monoton', style: 'neon', accent: '#22e6ff', tag: 'EVERY CAR IS A LIVE BSV TX', sub: 'OPEN WORLD · LIVE CHAIN', code: 'TB-CTY/03 · NIGHT SHIFT', extra: 'STEAL · DELIVER · RACE THE MEMPOOL' },
};
const c = CARDS[game];
if (!c || !frame || !out) throw new Error('usage: compose-game-card.mjs <rally|city> <frame.png> <out.jpg> [--side=..] [--font=..] [--zoom=..] [--fx=..] [--fy=..]');
const left = (opt.side ?? 'left') === 'left';
const tx = left ? 54 : W - 54;
const anchor = left ? 'start' : 'end';
const fontKey = opt.font ?? c.font;
const font = opentype.parse(readFileSync(new URL(`./fonts/${FONTS[fontKey]}`, import.meta.url)).buffer);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const COND = "Impact, 'Haettenschweiler', 'Arial Narrow Bold', sans-serif";
const MONO = "Menlo, 'Courier New', monospace";

/** Glyph-by-glyph outline (no GSUB shaping; some fonts' tables trip opentype.js). Returns path data + width. */
function outline(text, size, track = 0.02) {
  const p = new opentype.Path();
  let x = 0;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    p.extend(g.getPath(x, 0, size));
    x += (g.advanceWidth / font.unitsPerEm) * size + size * track;
  }
  const bb = p.getBoundingBox();
  return { d: p.toPathData(2), w: bb.x2 - bb.x1, x1: bb.x1, top: bb.y1, h: bb.y2 - bb.y1 };
}

/** Fit a line of text to a max width; returns outline at the chosen size. */
function fit(text, size, maxW, track) {
  let o = outline(text, size, track);
  if (o.w > maxW) o = outline(text, (size * maxW) / o.w, track);
  return o;
}

const hazard = (x, y, w, h, a = c.accent) => {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${INK}"/>`;
  for (let i = -h; i < w; i += 28) s += `<polygon points="${x + i},${y + h} ${x + i + 14},${y + h} ${x + i + 14 + h},${y} ${x + i + h},${y}" fill="${a}"/>`;
  return `<g clip-path="url(#hz${x}${y})"><clipPath id="hz${x}${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>${s}</g>`;
};

/** Rally: heavy italic (skewed) face, white / red, light edge wear, two speed streaks trailing behind. */
function rallyTitle() {
  const [t1, t2] = c.title;
  const maxW = 610;
  const a = fit(t1, 150, maxW, 0.01), b = fit(t2, 150, maxW, 0.01);
  const lines = [[a, WHITE, 168], [b, RED, 318]];
  let s = `<defs>
    <filter id="wear" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -14 12.4" result="m"/>
      <feComposite in="SourceGraphic" in2="m" operator="in"/>
    </filter>
    <filter id="shade" x="-10%" y="-10%" width="120%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>`;
  for (const [o, fill, base] of lines) {
    const x = left ? tx - o.x1 : tx - o.w - o.x1;
    const g = `transform="translate(${x},${base}) skewX(-14)"`;
    // speed streaks: two tapered bars trailing behind the word
    const sx = left ? -60 : -40, sw = o.w * 0.75;
    const streak = (y, hh, op) =>
      `<polygon points="${sx - 140},${y} ${sx + sw},${y - hh / 2} ${sx + sw},${y + hh / 2}" fill="${fill}" opacity="${op}"/>`;
    s += `<g ${g}>
      ${streak(-o.h * 0.62, 10, 0.55)}${streak(-o.h * 0.3, 5, 0.4)}
      <path d="${o.d}" fill="${INK}" opacity="0.65" filter="url(#shade)" transform="translate(4,7)"/>
      <path d="${o.d}" fill="${fill}" filter="url(#wear)"/>
    </g>`;
  }
  return s;
}

/** City: neon tubes — coloured outer glow, saturated tube, white-hot core, a couple of flicker gaps. */
function neonTitle() {
  const [t1, t2] = c.title;
  const maxW = 540;
  const mono = fontKey === 'monoton';
  const a = fit(t1, mono ? 120 : 96, maxW, mono ? 0 : 0.04), b = fit(t2, mono ? 120 : 96, maxW, mono ? 0 : 0.04);
  const lines = [[a, '#ff3df0', 175], [b, '#22e6ff', 175 + a.h + 46]];
  let s = `<defs>
    <filter id="glowW" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="glowN" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>`;
  for (const [o, col, base] of lines) {
    const x = left ? tx - o.x1 : tx - o.w - o.x1;
    const tube = mono ? 0 : 5;
    const gaps = 'stroke-dasharray="380 9 140 7 900"';
    s += `<g transform="translate(${x},${base})">
      <path d="${o.d}" fill="${mono ? col : 'none'}" stroke="${col}" stroke-width="${tube + 10}" opacity="0.75" filter="url(#glowW)"/>
      <path d="${o.d}" fill="${mono ? col : 'none'}" stroke="${col}" stroke-width="${tube + 4}" opacity="0.9" filter="url(#glowN)"/>
      ${mono ? `<path d="${o.d}" fill="${WHITE}" opacity="0.92"/>` : `<path d="${o.d}" fill="none" stroke="${col}" stroke-width="${tube}" stroke-linejoin="round" ${gaps}/>
      <path d="${o.d}" fill="none" stroke="${WHITE}" stroke-width="${tube * 0.38}" stroke-linejoin="round" ${gaps}/>`}
    </g>`;
  }
  return s;
}

function chrome() {
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
  ${c.style === 'rally' ? rallyTitle() : neonTitle()}
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

await sharp(base).composite([{ input: Buffer.from(chrome()) }])[out.endsWith('.png') ? 'png' : 'jpeg']({ quality: 82, mozjpeg: true }).toFile(out);
console.log('wrote', out);
