// $TERRORNODE bWalletX theme art: blood-red field, red neon "$TERRORNODE" wordmark dripping blood, outlined in
// electric-blue neon tube strokes, plus the Terrornode eye. Same neon + seeded drip technique as compose-neon-card.mjs.
// Usage: node scripts/og/compose-terrornode-wallet.mjs <cardFrame.png> <bannerFrame.png> [outDir=public/brand]
//   frames: headless /arcade/terrornode?dryrun=1 captures (HUD hidden, minigun firing).
// Writes terrornode-wallet-logo.png (256px, <=64 KB), terrornode-wallet-card.jpg (1011x637, <=256 KB),
// terrornode-room-banner.jpg (1500x500, <=256 KB).
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const PUP = process.env.PUPPETEER ?? '/Volumes/2026/Projects/bwx-web-layout/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { default: puppeteer } = await import(pathToFileURL(PUP).href);
const [cardFrame, bannerFrame, outDir = 'public/brand'] = process.argv.slice(2);
const RED = '#ff1a2e', BLUE = '#1ad8ff';

const eye = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
<defs><filter id="g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="i"><stop offset="0" stop-color="#ffb08a"/><stop offset=".5" stop-color="#ff2a2a"/><stop offset="1" stop-color="#b00a10"/></radialGradient>
<linearGradient id="d" x1="0" x2="1"><stop offset="0" stop-color="#3a0006"/><stop offset=".4" stop-color="#b0061a"/><stop offset=".55" stop-color="#e01530"/><stop offset="1" stop-color="#3a0006"/></linearGradient></defs>
<circle cx="256" cy="256" r="232" fill="#140004" stroke="${BLUE}" stroke-width="14" filter="url(#g)"/>
<circle cx="256" cy="256" r="232" fill="none" stroke="#e8fbff" stroke-width="4"/>
<g filter="url(#g)"><path d="M56 246 Q256 96 456 246 Q256 396 56 246Z" fill="none" stroke="${RED}" stroke-width="22" stroke-linejoin="round"/>
<circle cx="256" cy="246" r="66" fill="url(#i)"/><rect x="246" y="186" width="20" height="120" rx="5" fill="#0a0000"/></g>
<path d="M56 246 Q256 96 456 246 Q256 396 56 246Z" fill="none" stroke="#ffd0d4" stroke-width="5"/>
<path d="M238 318 h28 v92 a14 14 0 0 1 -28 0Z" fill="url(#d)"/><ellipse cx="252" cy="420" rx="21" ry="26" fill="url(#i)"/>
<path d="M318 300 h16 v40 a8 8 0 0 1 -16 0Z" fill="url(#d)"/><path d="M178 302 h14 v26 a7 7 0 0 1 -14 0Z" fill="url(#d)"/>
<ellipse cx="246" cy="410" rx="5" ry="9" fill="#ffc4c4" opacity=".7"/></svg>`;
const eyeUri = `data:image/svg+xml;base64,${Buffer.from(eye(512)).toString('base64')}`;

const scene = async (frame, W, H, o) => {
  const m = await sharp(frame).metadata();
  const s = Math.max(W / m.width, H / m.height) * (o.zoom ?? 1);
  const sw = Math.round(m.width * s), sh = Math.round(m.height * s);
  const bg = await sharp(frame).resize(sw, sh).extract({ left: Math.round((sw - W) * (o.fx ?? 0.5)), top: Math.round((sh - H) * (o.fy ?? 0.5)), width: W, height: H })
    .modulate({ saturation: 1.3, brightness: 0.8 }).jpeg({ quality: 92 }).toBuffer();
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@900&family=Space+Mono:wght@700&display=block" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{width:${W}px;height:${H}px;overflow:hidden;background:#0a0003;position:relative}
.bg{position:absolute;inset:0;background:url(data:image/jpeg;base64,${bg.toString('base64')}) center/cover}
.red{position:absolute;inset:0;background:linear-gradient(${o.dir},rgba(70,0,8,.93) 0,rgba(90,0,12,.78) ${o.stop}%,rgba(60,0,8,.15) ${o.stop + 30}%,transparent),radial-gradient(ellipse at 70% 60%,transparent 40%,rgba(30,0,4,.55));mix-blend-mode:normal}
.rain{position:absolute;inset:0;opacity:.3;background:repeating-linear-gradient(104deg,transparent 0 17px,rgba(190,220,255,.22) 17px 18px,transparent 18px 41px)}
.frame{position:absolute;inset:10px;border:3px solid ${BLUE};border-radius:14px;box-shadow:0 0 8px ${BLUE},0 0 22px ${BLUE},inset 0 0 8px ${BLUE},inset 0 0 22px ${BLUE}88}
.frame2{position:absolute;inset:10px;border:1px solid #e8fbff;border-radius:14px}
.eye{position:absolute;left:${o.eyeX}px;top:${o.eyeY}px;width:${o.eye}px;height:${o.eye}px}
.t{position:absolute;left:${o.tx}px;top:${o.ty}px;white-space:nowrap;font:900 ${o.size}px/0.9 'Big Shoulders Display',sans-serif;letter-spacing:.01em;color:#fff;
 -webkit-text-stroke:3px ${BLUE};paint-order:stroke fill;
 text-shadow:0 0 2px #fff,0 0 8px ${RED},0 0 18px ${RED},0 0 36px ${RED},0 0 70px ${RED},0 0 4px ${BLUE},0 0 12px ${BLUE}}
.k{position:absolute;left:${o.tx + 4}px;top:${o.ky}px;font:700 ${o.ks}px 'Space Mono',monospace;letter-spacing:.16em;color:#e8fbff;text-shadow:0 0 6px ${BLUE},0 0 14px ${BLUE}}
.drip{position:absolute;background:linear-gradient(90deg,#3a0006,#9a0414 35%,#d0122a 50%,#7a0210 70%,#2a0004);box-shadow:0 0 8px #ff1a2e66}
.bulb{position:absolute;border-radius:50% 50% 50% 50% / 58% 58% 42% 42%;background:radial-gradient(circle at 35% 30%,#ff8a8a 0 8%,#c80e24 22%,#6a000c 75%,#2a0004)}
</style></head><body><div class="bg"></div><div class="red"></div><div class="rain"></div>
<img class="eye" src="${eyeUri}"><div class="t">$TERRORNODE</div><div class="k">${o.kicker}</div>
<div class="frame"></div><div class="frame2"></div></body></html>`;
};

const drip = (maxLen) => {
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const el = document.querySelector('.t'); const text = el.firstChild;
  const add = (cls, css) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, css); el.before(d); };
  for (let i = 0; i < text.length; i++) {
    const r = document.createRange(); r.setStart(text, i); r.setEnd(text, i + 1); const b = r.getBoundingClientRect();
    const n = 1 + (rnd() < 0.45 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const w = (4 + rnd() * 6) * b.height / 120; const long = rnd() < 0.3;
      const len = (long ? 0.6 + rnd() * 1 : 0.12 + rnd() * 0.3) * maxLen; const x = b.left + b.width * (0.15 + rnd() * 0.7); const top = b.top + b.height * 0.84;
      add('drip', { left: x - w / 2 + 'px', top: top + 'px', height: len + 'px', width: w + 'px', borderRadius: `0 0 ${w / 2}px ${w / 2}px` });
      add('bulb', { left: x - w * 0.8 + 'px', top: top + len - w * 0.9 + 'px', width: w * 1.6 + 'px', height: w * 1.9 + 'px' });
    }
  }
};

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const shot = async (html, W, H, maxLen, opts = {}) => {
    const p = await b.newPage(); await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await p.setContent(html, { waitUntil: 'networkidle0' }); await p.evaluate(() => document.fonts.ready);
    if (maxLen) await p.evaluate(drip, maxLen);
    const png = await p.screenshot({ type: 'png', omitBackground: !!opts.transparent }); await p.close(); return png;
  };
  const jpg = async (png, file) => {
    let q = 88, buf; do { buf = await sharp(png).jpeg({ quality: q, mozjpeg: true }).toBuffer(); q -= 4; } while (buf.length > 250_000 && q > 40);
    await sharp(buf).toFile(`${outDir}/${file}`); console.log('wrote', file, buf.length);
  };
  // 1. logo: 256px square, transparent
  const logoPng = await shot(`<!doctype html><body style="margin:0;background:transparent">${eye(256)}</body>`, 256, 256, 0, { transparent: true });
  const logo = await sharp(logoPng).png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
  await sharp(logo).toFile(`${outDir}/terrornode-wallet-logo.png`); console.log('wrote terrornode-wallet-logo.png', logo.length);
  // 2. card 1011x637
  await jpg(await shot(await scene(cardFrame, 1011, 637, { dir: '180deg', stop: 18, zoom: 1.05, fx: 0.6, fy: 0.6, eyeX: 36, eyeY: 34, eye: 128, tx: 182, ty: 44, size: 124, ky: 168, ks: 17, kicker: 'ROOM // ASSAULT ON TERRORNODE' }), 1011, 637, 120), 'terrornode-wallet-card.jpg');
  // 3. banner 1500x500
  await jpg(await shot(await scene(bannerFrame, 1500, 500, { dir: '90deg', stop: 34, zoom: 1, fx: 0.5, fy: 0.62, eyeX: 48, eyeY: 120, eye: 210, tx: 290, ty: 120, size: 170, ky: 82, ks: 20, kicker: '$TERRORNODE ROOM // EVERY BULLET = 1 REAL BSV TX' }), 1500, 500, 150), 'terrornode-room-banner.jpg');
} finally { await b.close(); }
