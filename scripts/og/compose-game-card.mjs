// DR/WipEout share card (1200x630) from a real in-game frame.
// Usage: node scripts/og/compose-game-card.mjs <rally|city> <frame.png> <out.png> [variant a|b|c]
// Frames are captured from `pnpm dev` with the HUD hidden (kept in .private/og-drafts, never committed).
import sharp from 'sharp';

const [, , game, frame, out, variant = 'a'] = process.argv;
const W = 1200, H = 630;
const RED = '#ff2a2a', INK = '#0a0a0c', WHITE = '#ffffff';

const CARDS = {
  rally: { title: ['TOKEN', 'RALLY'], accent: '#ffb000', tag: 'EVERY LITRE OF FUEL IS A BSV TX', sub: 'LIVE · MULTIPLAYER', code: 'TB-RLY/01', extra: 'RIVALS = LIVE MAINNET TXS' },
  city: { title: ['SATOSHI', 'CITY'], accent: '#22e6ff', tag: 'EVERY CAR IS A LIVE BSV TX', sub: 'OPEN WORLD · LIVE CHAIN', code: 'TB-CTY/01', extra: 'STEAL · DELIVER · RACE THE MEMPOOL' },
};
const c = CARDS[game];
if (!c || !frame || !out) throw new Error('usage: compose-game-card.mjs <rally|city> <frame.png> <out.png> [a|b|c]');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const FONT = "Impact, 'Haettenschweiler', 'Arial Narrow Bold', sans-serif";
const MONO = "Menlo, 'Courier New', monospace";

const hazard = (x, y, w, h, a = c.accent) => {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${INK}"/>`;
  for (let i = -h; i < w; i += 28) s += `<polygon points="${x + i},${y + h} ${x + i + 14},${y + h} ${x + i + 14 + h},${y} ${x + i + h},${y}" fill="${a}"/>`;
  return `<g clip-path="url(#hz${x}${y})"><clipPath id="hz${x}${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>${s}</g>`;
};

function overlay() {
  const [t1, t2] = c.title;
  const left = variant !== 'c';
  const tx = left ? 54 : W - 54;
  const anchor = left ? 'start' : 'end';
  const titleSize = variant === 'b' ? 150 : 170;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="fade" x1="${left ? 0 : 1}" y1="0" x2="${left ? 1 : 0}" y2="0">
      <stop offset="0" stop-color="${INK}" stop-opacity="0.92"/><stop offset="0.42" stop-color="${INK}" stop-opacity="0.55"/><stop offset="0.7" stop-color="${INK}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="${INK}" stop-opacity="0"/><stop offset="1" stop-color="${INK}" stop-opacity="0.85"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <rect width="${W}" height="${H}" fill="url(#floor)"/>
  ${hazard(0, 0, W, 16)}
  ${variant === 'b' ? `<polygon points="0,${H - 150} ${W},${H - 230} ${W},${H - 205} 0,${H - 125}" fill="${RED}" opacity="0.9"/>` : ''}
  <!-- racing stripes -->
  <g transform="skewX(-18)">
    <rect x="${left ? 150 : W - 250}" y="16" width="34" height="${H - 76}" fill="${RED}" opacity="0.85"/>
    <rect x="${left ? 194 : W - 206}" y="16" width="12" height="${H - 76}" fill="${WHITE}" opacity="0.85"/>
  </g>
  <text x="${tx}" y="46" text-anchor="${anchor}" font-family="${MONO}" font-size="17" font-weight="700" fill="${c.accent}" letter-spacing="3">${c.code} — TOKENBLASTER ARCADE</text>
  <g font-family="${FONT}" font-size="${titleSize}" text-anchor="${anchor}" letter-spacing="2">
    <text x="${tx + (left ? 6 : -6)}" y="${200 + 6}" fill="${RED}">${t1}</text>
    <text x="${tx}" y="200" fill="${WHITE}">${t1}</text>
    <text x="${tx + (left ? 6 : -6)}" y="${200 + titleSize * 0.92 + 6}" fill="${INK}">${t2}</text>
    <text x="${tx}" y="${200 + titleSize * 0.92}" fill="${RED}">${t2}</text>
  </g>
  <g transform="translate(${left ? 54 : W - 54 - 560}, ${variant === 'b' ? 430 : 420})">
    <rect width="560" height="50" fill="${WHITE}"/>
    <rect width="14" height="50" fill="${RED}"/>
    <text x="30" y="35" font-family="${FONT}" font-size="31" fill="${INK}" letter-spacing="1.5">${esc(c.tag)}</text>
    <rect y="58" width="${c.sub.length * 17 + 36}" height="36" fill="${RED}"/>
    <text x="18" y="84" font-family="${MONO}" font-size="20" font-weight="700" fill="${WHITE}" letter-spacing="2">${esc(c.sub)}</text>
  </g>
  <rect x="0" y="${H - 44}" width="${W}" height="44" fill="${INK}"/>
  <rect x="0" y="${H - 44}" width="${W}" height="4" fill="${RED}"/>
  <text x="54" y="${H - 14}" font-family="${MONO}" font-size="18" font-weight="700" fill="${WHITE}" letter-spacing="2">TOKENBLASTER<tspan fill="${RED}">.LOL</tspan></text>
  <text x="${W - 54}" y="${H - 14}" text-anchor="end" font-family="${MONO}" font-size="15" fill="${c.accent}" letter-spacing="2">${esc(c.extra)} ▲▲▲</text>
</svg>`;
}

const base = await sharp(frame).resize(W, H, { fit: 'cover', position: 'attention' }).modulate({ saturation: 1.15 }).linear(1.08, -6).toBuffer();
await sharp(base).composite([{ input: Buffer.from(overlay()) }])[out.endsWith('.png') ? 'png' : 'jpeg']({ quality: 82, mozjpeg: true }).toFile(out);
console.log('wrote', out);
