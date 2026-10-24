// A fan of square cards (1Sat Ordnance gun cards) on a dark glowing backdrop, as a 1200x630 frame for compose-dr-card.mjs.
// Usage: node scripts/og/prep-fan-frame.mjs <out.png> <card1> <card2> <card3> [--glow=#hex] [--bg=#hex]
import sharp from 'sharp';

const args = process.argv.slice(2);
const [out, ...cards] = args.filter((a) => !a.startsWith('--'));
const o = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const W = 1200, H = 630, bg = o.bg ?? '#0b0a08', glow = o.glow ?? '#ffb800';
const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
  <radialGradient id="g" cx="0.72" cy="0.5" r="0.6"><stop offset="0" stop-color="${glow}" stop-opacity="0.4"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
  <pattern id="p" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="${glow}" stroke-opacity="0.1"/></pattern></defs>
  <rect width="${W}" height="${H}" fill="${bg}"/><rect width="${W}" height="${H}" fill="url(#p)"/><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
const size = 400;
// back-left, back-right, front-centre
const slots = [{ cx: 700, cy: 300, rot: -9, s: 0.86 }, { cx: 1040, cy: 320, rot: 8, s: 0.86 }, { cx: 870, cy: 330, rot: -1.5, s: 1 }];
const layers = [];
for (const [i, c] of cards.entries()) {
  const sl = slots[i];
  const n = Math.round(size * sl.s);
  const sq = await sharp(c).resize(n, n).composite([{ input: Buffer.from(`<svg width="${n}" height="${n}"><rect width="${n}" height="${n}" rx="14" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
  const rot = await sharp(sq).rotate(sl.rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const m = await sharp(rot).metadata();
  const sh = await sharp(rot).ensureAlpha().modulate({ brightness: 0 }).blur(14).png().toBuffer();
  const left = Math.round(sl.cx - m.width / 2), top = Math.round(sl.cy - m.height / 2);
  layers.push({ input: sh, left: left + 10, top: top + 16 }, { input: rot, left, top });
}
await sharp(backdrop).composite(layers).png().toFile(out);
console.log('wrote', out);
