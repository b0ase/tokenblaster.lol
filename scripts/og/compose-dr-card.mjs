// House-style share card (1200x630) from a real in-game frame: heavy italic title (white + red), TB-xxx kicker,
// TOKENBLASTER.LOL wordmark, yellow sticker, katakana line, hazard stripe along the bottom.
// Usage: node scripts/og/compose-dr-card.mjs <card.json> [out.jpg]
//   card.json: { frame, out, kicker, section, line1, line2, tagline: [..], sticker, kana, fx, fy, zoom, side, shade, size1, size2, boost }
// Frames come from `pnpm dev` captures (kept outside the repo). Fonts are fetched from Google Fonts at render time
// (Barlow Condensed 900 italic, Space Mono, Noto Sans JP 900, Audiowide: the same DR pair the site uses).
// Needs puppeteer-core + sharp; set CHROME and PUPPETEER to override the defaults below.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const PUP = process.env.PUPPETEER ?? '/Volumes/2026/Projects/bwx-web-layout/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { default: puppeteer } = await import(pathToFileURL(PUP).href);

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3] ?? cfg.out;
const W = 1200, H = 630;
const left = (cfg.side ?? 'left') === 'left';

// cover-crop the frame to 1200x630 (zoom/focus), light grade, then let CSS lay the poster over it
// padLeft/padRight (fraction of frame width) mirror-extend the frame so the subject can sit away from the title
let src = sharp(cfg.frame);
const m0 = await src.metadata();
if (cfg.padLeft || cfg.padRight) {
  const ext = await src.extend({ left: Math.round((cfg.padLeft ?? 0) * m0.width), right: Math.round((cfg.padRight ?? 0) * m0.width), extendWith: 'mirror' }).blur(cfg.padBlur ?? 0.3).png().toBuffer();
  src = sharp(ext);
}
const srcBuf = await src.png().toBuffer();
const meta = await sharp(srcBuf).metadata();
const scale = Math.max(W / meta.width, H / meta.height) * (cfg.zoom ?? 1);
const sw = Math.round(meta.width * scale), sh = Math.round(meta.height * scale);
const base = await sharp(srcBuf)
  .resize(sw, sh)
  .extract({ left: Math.round((sw - W) * (cfg.fx ?? 0.5)), top: Math.round((sh - H) * (cfg.fy ?? 0.5)), width: W, height: H })
  .modulate({ saturation: cfg.sat ?? 1.2, brightness: cfg.boost ?? 1 })
  .linear(1.1, -8)
  .jpeg({ quality: 92 })
  .toBuffer();
const bg = `data:image/jpeg;base64,${base.toString('base64')}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Audiowide&family=Barlow+Condensed:ital,wght@1,800;1,900&family=Noto+Sans+JP:wght@900&family=Space+Mono:wght@400;700&display=block" rel="stylesheet">
<style>
:root{--red:#ff3b30;--yellow:#ffb800;--ink:#0a0a0c}
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:#000;position:relative;font-family:'Barlow Condensed',sans-serif}
.bg{position:absolute;inset:0;background:url(${bg}) center/cover}
.shade{position:absolute;inset:0;background:
  linear-gradient(${left ? 90 : 270}deg, rgba(5,5,8,${cfg.shade ?? 0.82}) 0%, rgba(5,5,8,${(cfg.shade ?? 0.82) * 0.55}) 38%, rgba(5,5,8,0) 66%),
  linear-gradient(0deg, rgba(5,5,8,.85) 0%, rgba(5,5,8,0) 34%),
  linear-gradient(180deg, rgba(5,5,8,.6) 0%, rgba(5,5,8,0) 22%)}
.frame{position:absolute;inset:6px;border:1px solid rgba(255,255,255,.28)}
.kick{position:absolute;top:32px;${left ? 'left' : 'right'}:44px;font:700 15px 'Space Mono',monospace;letter-spacing:.14em;color:#fff;opacity:.92}
.sect{position:absolute;top:32px;${left ? 'right' : 'left'}:44px;font:700 15px 'Space Mono',monospace;letter-spacing:.1em;color:#fff;opacity:.8}
.word{position:absolute;top:58px;${left ? 'left' : 'right'}:44px;font:400 31px 'Audiowide',sans-serif;color:#fff;letter-spacing:.01em;text-shadow:2px 2px 0 var(--red)}
.word b{color:var(--red);font-weight:400;text-shadow:2px 2px 0 #fff3}
.t{position:absolute;${left ? 'left' : 'right'}:44px;font-weight:900;font-style:italic;text-transform:uppercase;line-height:.84;letter-spacing:-.005em;white-space:nowrap;text-shadow:5px 6px 0 rgba(0,0,0,.55)}
.t1{color:#fff;top:104px}
.t2{color:var(--red);top:${104 + Math.round((cfg.size1 ?? 200) * 0.88)}px}
.tag{position:absolute;${left ? 'left' : 'right'}:46px;bottom:124px;font:800 italic 31px/1.04 'Barlow Condensed',sans-serif;color:#fff;text-transform:uppercase;text-shadow:2px 2px 0 rgba(0,0,0,.6);${left ? '' : 'text-align:right'}}
.stk{position:absolute;${left ? 'left' : 'right'}:44px;bottom:56px;background:var(--yellow);color:var(--ink);font:900 italic 30px 'Barlow Condensed',sans-serif;text-transform:uppercase;padding:7px 18px 6px;border:3px solid #fff;transform:rotate(-1.6deg);box-shadow:4px 5px 0 rgba(0,0,0,.5);letter-spacing:.01em}
.kana{position:absolute;${left ? 'right' : 'left'}:44px;bottom:58px;font:900 30px 'Noto Sans JP',sans-serif;color:var(--red);text-shadow:2px 2px 0 rgba(0,0,0,.6);letter-spacing:.04em}
.haz{position:absolute;left:0;right:0;bottom:0;height:40px;background:repeating-linear-gradient(-45deg,var(--yellow) 0 22px,var(--ink) 22px 44px);border-top:2px solid var(--ink)}
</style></head><body>
<div class="bg"></div><div class="shade"></div><div class="frame"></div>
<div class="kick">${esc(cfg.kicker)}</div><div class="sect">${esc(cfg.section ?? 'TOKENBLASTER.LOL')}</div>
<div class="word">TOKENBLASTER<b>.LOL</b></div>
<div class="t t1" id="t1" style="font-size:${cfg.size1 ?? 200}px">${esc(cfg.line1)}</div>
<div class="t t2" id="t2" style="font-size:${cfg.size2 ?? cfg.size1 ?? 200}px">${esc(cfg.line2)}</div>
<div class="tag">${(cfg.tagline ?? []).map(esc).join('<br>')}</div>
<div class="stk">${esc(cfg.sticker ?? 'EVERY BULLET = 1 REAL BSV TX')}</div>
<div class="kana">${esc(cfg.kana ?? '')}</div>
<div class="haz"></div>
</body></html>`;

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await b.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png' });
  let q = 84, buf;
  do { buf = await sharp(png).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer(); q -= 4; } while (buf.length > 290_000 && q > 50);
  await sharp(buf).toFile(out);
  console.log('wrote', out, buf.length, 'bytes');
} finally { await b.close(); }
