// Neon share card (1200x630): darkened, softly blurred in-game frame with bloom + rain, glowing neon-tube title
// (white-hot core, coloured halo, tube flicker gaps, wet-floor reflection), neon katakana sign, TOKENBLASTER.LOL
// wordmark, yellow sticker and hazard stripe.
// Usage: node scripts/og/compose-neon-card.mjs <card.json> [out.jpg]
//   card.json: { frame, out, kicker, section, line1, line2, c1, c2, font, size1, size2, tagline[], sticker, kana, sign, badge?: { logo, text }, padLeft, zoom, fx, fy, dim, blur, drip }
//   drip: true runs glossy blood drips down from the title letters (seeded, so re-renders match).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const PUP = process.env.PUPPETEER ?? '/Volumes/2026/Projects/bwx-web-layout/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { default: puppeteer } = await import(pathToFileURL(PUP).href);
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3] ?? cfg.out;
const W = 1200, H = 630;
const FONTS = {
  tilt: { fam: 'Tilt Neon', css: 'Tilt+Neon', w: 400, style: 'normal', track: '0.02em', lh: 0.95 },
  monoton: { fam: 'Monoton', css: 'Monoton', w: 400, style: 'normal', track: '0.01em', lh: 1 },
  orbitron: { fam: 'Orbitron', css: 'Orbitron:wght@900', w: 900, style: 'normal', track: '0.02em', lh: 0.95 },
  bigshoulders: { fam: 'Big Shoulders Display', css: 'Big+Shoulders+Display:wght@900', w: 900, style: 'normal', track: '0.01em', lh: 0.88 },
  bungee: { fam: 'Bungee Inline', css: 'Bungee+Inline', w: 400, style: 'normal', track: '0.01em', lh: 0.95 },
};
const f = FONTS[cfg.font ?? 'tilt'];
const c1 = cfg.c1 ?? '#ff2bd6', c2 = cfg.c2 ?? '#19e6ff';

let src = sharp(cfg.frame);
const m0 = await src.metadata();
if (cfg.padLeft) src = sharp(await src.extend({ left: Math.round(cfg.padLeft * m0.width), extendWith: 'mirror' }).png().toBuffer());
const sb = await src.png().toBuffer();
const meta = await sharp(sb).metadata();
const scale = Math.max(W / meta.width, H / meta.height) * (cfg.zoom ?? 1);
const sw = Math.round(meta.width * scale), sh = Math.round(meta.height * scale);
const base = await sharp(sb).resize(sw, sh)
  .extract({ left: Math.round((sw - W) * (cfg.fx ?? 0.5)), top: Math.round((sh - H) * (cfg.fy ?? 0.5)), width: W, height: H })
  .modulate({ saturation: cfg.sat ?? 1.25, brightness: cfg.dim ?? 0.62 }).blur(cfg.blur ?? 1.4).jpeg({ quality: 92 }).toBuffer();
const bg = `data:image/jpeg;base64,${base.toString('base64')}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const neon = (c, core = '#fff') => `color:${core};text-shadow:0 0 2px #fff,0 0 6px ${core},0 0 14px ${c},0 0 28px ${c},0 0 52px ${c},0 0 90px ${c}`;
const s1 = cfg.size1 ?? 150, s2 = cfg.size2 ?? s1;

const npg = cfg.badge ? `<div class="npg"><img src="data:image/png;base64,${(await sharp(cfg.badge.logo).png().toBuffer()).toString('base64')}"><span>${esc(cfg.badge.text)}</span></div>` : '';

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=${f.css}&family=Audiowide&family=Barlow+Condensed:ital,wght@1,800;1,900&family=Noto+Sans+JP:wght@900&family=Space+Mono:wght@700&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:#000;position:relative}
.bg{position:absolute;inset:0;background:url(${bg}) center/cover}
.mood{position:absolute;inset:0;background:radial-gradient(ellipse at 20% 40%,${c1}22,transparent 55%),radial-gradient(ellipse at 85% 30%,${c2}26,transparent 50%),linear-gradient(90deg,rgba(3,2,10,.72),rgba(3,2,10,.25) 55%,rgba(3,2,10,.1)),linear-gradient(0deg,rgba(3,2,10,.9),transparent 38%),linear-gradient(180deg,rgba(3,2,10,.55),transparent 22%)}
.rain{position:absolute;inset:0;opacity:.35;background:repeating-linear-gradient(104deg,transparent 0 17px,rgba(190,220,255,.22) 17px 18px,transparent 18px 41px),repeating-linear-gradient(101deg,transparent 0 53px,rgba(255,255,255,.18) 53px 54px,transparent 54px 97px)}
.bloom{position:absolute;inset:0;mix-blend-mode:screen;background:radial-gradient(circle at 78% 62%,${c2}55,transparent 22%),radial-gradient(circle at 12% 88%,${c1}44,transparent 26%)}
.floor{position:absolute;left:0;right:0;bottom:40px;height:150px;background:linear-gradient(0deg,transparent,${c1}22 60%,transparent);mix-blend-mode:screen}
.frame{position:absolute;inset:6px;border:1px solid rgba(255,255,255,.22)}
.kick{position:absolute;top:30px;left:44px;font:700 15px 'Space Mono',monospace;letter-spacing:.14em;color:${c2};text-shadow:0 0 8px ${c2}}
.sect{position:absolute;top:30px;right:44px;font:700 15px 'Space Mono',monospace;letter-spacing:.1em;color:#fff;opacity:.85}
.word{position:absolute;top:56px;left:44px;font:400 31px 'Audiowide',sans-serif;color:#fff;text-shadow:2px 2px 0 #ff3b30,0 0 18px #ff3b3088}
.word b{color:#ff3b30;font-weight:400}
.ul{position:absolute;left:44px;top:100px;width:330px;height:4px;border-radius:4px;background:#fff;box-shadow:0 0 6px #fff,0 0 14px ${c2},0 0 30px ${c2}}
.t{position:absolute;left:44px;white-space:nowrap;font-family:'${f.fam}',sans-serif;font-weight:${f.w};letter-spacing:${f.track};line-height:${f.lh};text-transform:uppercase}
.t1{top:112px;font-size:${s1}px;${neon(c1)}}
.t2{top:${112 + Math.round(s1 * f.lh) + 6}px;font-size:${s2}px;${neon(c2)};-webkit-box-reflect:below -4px linear-gradient(transparent 55%,rgba(255,255,255,.28))}
.flick{animation:none;opacity:1}
.gap{position:absolute;background:#05030c;transform:skewX(-12deg)}
.tag{position:absolute;left:46px;bottom:118px;font:800 italic 29px/1.04 'Barlow Condensed',sans-serif;color:#fff;text-transform:uppercase;text-shadow:0 0 10px ${c2}99,2px 2px 0 rgba(0,0,0,.7)}
.stk{position:absolute;left:44px;bottom:54px;background:#ffb800;color:#0a0a0c;font:900 italic 30px 'Barlow Condensed',sans-serif;text-transform:uppercase;padding:7px 18px 6px;border:3px solid #fff;transform:rotate(-1.6deg);box-shadow:0 0 22px #ffb80088,4px 5px 0 rgba(0,0,0,.5)}
.sign{position:absolute;right:46px;top:96px;writing-mode:vertical-rl;font:900 40px 'Noto Sans JP',sans-serif;letter-spacing:.12em;color:#fff;padding:16px 10px;border:3px solid ${c2};border-radius:10px;${neon(c2).replace('color:#fff;','')};box-shadow:0 0 12px ${c2},inset 0 0 12px ${c2}}
.kana{position:absolute;right:44px;bottom:56px;font:900 28px 'Noto Sans JP',sans-serif;${neon(c1)}}
.drip{position:absolute;background:linear-gradient(90deg,#3a0006,#9a0414 35%,#d0122a 50%,#7a0210 70%,#2a0004);box-shadow:0 0 8px #ff1a2e66;filter:drop-shadow(0 2px 2px rgba(0,0,0,.6))}
.drip::after{content:'';position:absolute;left:28%;top:6%;width:18%;height:70%;border-radius:3px;background:linear-gradient(180deg,rgba(255,170,170,.0),rgba(255,190,190,.55),rgba(255,190,190,0))}
.bulb{position:absolute;border-radius:50% 50% 50% 50% / 58% 58% 42% 42%;background:radial-gradient(circle at 35% 30%,#ff8a8a 0 8%,#c80e24 22%,#6a000c 75%,#2a0004);box-shadow:0 0 6px #ff1a2e55}
.pool{position:absolute;border-radius:50%;background:radial-gradient(ellipse at 45% 40%,#d0122acc,#6a000caa 55%,transparent 72%);filter:blur(.6px)}
.npg{position:absolute;right:136px;top:100px;display:flex;flex-direction:column;align-items:center;gap:6px}.npg img{height:86px;filter:drop-shadow(0 3px 10px rgba(0,0,0,.7))}.npg span{font:700 15px 'Space Mono',monospace;letter-spacing:.16em;color:#ff5fb4;text-shadow:0 0 8px #ff5fb488,0 2px 2px #000}
.haz{position:absolute;left:0;right:0;bottom:0;height:40px;background:repeating-linear-gradient(-45deg,#ffb800 0 22px,#0a0a0c 22px 44px);border-top:2px solid #0a0a0c}
</style></head><body>
<div class="bg"></div><div class="mood"></div><div class="floor"></div><div class="rain"></div><div class="bloom"></div><div class="frame"></div>
<div class="kick">${esc(cfg.kicker)}</div><div class="sect">${esc(cfg.section ?? 'TOKENBLASTER.LOL')}</div>
<div class="word">TOKENBLASTER<b>.LOL</b></div><div class="ul"></div>
<div class="t t1">${esc(cfg.line1)}</div>
<div class="t t2">${esc(cfg.line2)}</div>
<div class="tag">${(cfg.tagline ?? []).map(esc).join('<br>')}</div>
<div class="stk">${esc(cfg.sticker ?? 'EVERY BULLET = 1 REAL BSV TX')}</div>
${cfg.sign ? `<div class="sign">${esc(cfg.sign)}</div>` : ''}
<div class="kana">${esc(cfg.kana ?? '')}</div>
${npg}<div class="haz"></div>
</body></html>`;

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await b.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  if (cfg.drip) await page.evaluate(() => {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const add = (cls, css) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, css); document.body.insertBefore(d, document.querySelector('.tag')); return d; };
    for (const el of document.querySelectorAll('.t')) {
      const text = el.firstChild; const isLast = el.classList.contains('t2');
      for (let i = 0; i < text.length; i++) {
        if (text.data[i] === ' ') continue;
        const r = document.createRange(); r.setStart(text, i); r.setEnd(text, i + 1);
        const b = r.getBoundingClientRect(); const n = 1 + (rnd() < 0.45 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const w = 5 + rnd() * 7; const long = rnd() < (isLast ? 0.35 : 0.2);
          const len = long ? 70 + rnd() * 120 : 14 + rnd() * 40;
          const x = b.left + b.width * (0.12 + rnd() * 0.76); const top = b.top + b.height * 0.86;
          add('drip', { left: x - w / 2 + 'px', top: top + 'px', height: len + 'px', width: w + 'px', borderRadius: '0 0 ' + w / 2 + 'px ' + w / 2 + 'px' });
          add('bulb', { left: x - w * 0.8 + 'px', top: top + len - w * 0.9 + 'px', width: w * 1.6 + 'px', height: w * 1.9 + 'px' });
          if (long && rnd() < 0.6) { const s = w * (0.8 + rnd() * 0.6); add('bulb', { left: x - s / 2 + 'px', top: top + len + 18 + rnd() * 50 + 'px', width: s + 'px', height: s * 1.25 + 'px' }); }
          if (isLast && long && rnd() < 0.5) add('pool', { left: x - 40 + 'px', top: Math.min(top + len + 60 + rnd() * 40, 520) + 'px', width: 80 + rnd() * 50 + 'px', height: 12 + rnd() * 6 + 'px' });
        }
      }
    }
  });
  const png = await page.screenshot({ type: 'png' });
  let q = 84, buf;
  do { buf = await sharp(png).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer(); q -= 4; } while (buf.length > 290_000 && q > 50);
  await sharp(buf).toFile(out);
  console.log('wrote', out, buf.length);
} finally { await b.close(); }
