// Turn a flat game-board screenshot (2048 tiles, Coin Pop column, Token Potions grid) into a 1200x630 frame for
// compose-dr-card.mjs: the board is cropped, tilted and dropped on a dark glowing backdrop on the right-hand side.
// Usage: node scripts/og/prep-board-frame.mjs <src.png> <out.png> --crop=x,y,w,h [--glow=#hex] [--bg=#hex] [--rot=-6] [--h=640] [--cx=860] [--cy=315]
import sharp from 'sharp';

const args = process.argv.slice(2);
const [src, out] = args.filter((a) => !a.startsWith('--'));
const o = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const W = 1200, H = 630;
const [cx0, cy0, cw, ch] = o.crop.split(',').map(Number);
const bg = o.bg ?? '#0a0a12', glow = o.glow ?? '#ff3b30';
const rot = +(o.rot ?? -6), bh = +(o.h ?? 640), cx = +(o.cx ?? 860), cy = +(o.cy ?? 315);

const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g" cx="${cx / W}" cy="${cy / H}" r="0.62"><stop offset="0" stop-color="${glow}" stop-opacity="0.55"/><stop offset="0.5" stop-color="${glow}" stop-opacity="0.14"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="${glow}" stroke-opacity="0.13" stroke-width="1"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="${bg}"/><rect width="${W}" height="${H}" fill="url(#grid)"/><rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>`);

const board = await sharp(src).extract({ left: cx0, top: cy0, width: cw, height: ch }).resize({ height: bh }).png().toBuffer();
const bm = await sharp(board).metadata();
const rounded = await sharp(board).composite([{ input: Buffer.from(`<svg width="${bm.width}" height="${bm.height}"><rect width="${bm.width}" height="${bm.height}" rx="18" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
const tilted = await sharp(rounded).rotate(rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const tm = await sharp(tilted).metadata();
const shadow = await sharp(tilted).ensureAlpha().modulate({ brightness: 0 }).blur(18).png().toBuffer();
const left = Math.round(cx - tm.width / 2), top = Math.round(cy - tm.height / 2);
// the tilted board may bleed off the card: composite on a padded canvas, then crop back to 1200x630
const pad = 600;
const big = await sharp(backdrop).extend({ top: pad, bottom: pad, left: pad, right: pad, background: bg }).png().toBuffer();
const comp = await sharp(big)
  .composite([{ input: shadow, left: left + 14 + pad, top: top + 20 + pad }, { input: tilted, left: left + pad, top: top + pad }])
  .png().toBuffer();
await sharp(comp).extract({ left: pad, top: pad, width: W, height: H }).png().toFile(out);
console.log('wrote', out);
