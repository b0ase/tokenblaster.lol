// /stresstest share card (1200x630): the report's headline number as the hero, the real minute-by-minute speed
// chart in a framed panel on the right, the TERRORNODE skull disc on its corner, over the blurred banner art.
// Usage: node scripts/og/compose-stresstest-card.mjs [out.jpg]   (default public/og/stresstest-v1.jpg)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const PUP = process.env.PUPPETEER ?? '/Volumes/2026/Projects/bwx-web-layout/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { default: puppeteer } = await import(pathToFileURL(PUP).href);
const out = process.argv[2] ?? 'public/og/stresstest-v1.jpg';
const W = 1200, H = 630;

const b64 = (p) => readFileSync(p).toString('base64');
const banner = await sharp('public/brand/terrornode-banner.jpg').resize(W, H, { fit: 'cover' }).blur(10).modulate({ brightness: 0.85, saturation: 1.45 }).jpeg({ quality: 88 }).toBuffer();
const skull = b64('public/brand/terrornode-skull.png');

// the chart: the same per-minute series the page draws (src/lib/stresstest/series.ts)
const src = readFileSync('src/lib/stresstest/series.ts', 'utf8');
const SERIES = JSON.parse(src.slice(src.indexOf('= ') + 2, src.lastIndexOf(';')));
const CW = 422, CH = 220, x0 = 720, x1 = 1110, yMax = 1700;
const X = (m) => ((m - x0) / (x1 - x0)) * CW, Y = (v) => CH - (v / yMax) * CH;
const paths = Object.values(SERIES).map((pts) => {
  const line = pts.map(([m, v], i) => `${i ? 'L' : 'M'}${X(m).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return { line, area: `${line} L${X(pts.at(-1)[0]).toFixed(1)},${CH} L${X(pts[0][0]).toFixed(1)},${CH} Z` };
});

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Chakra+Petch:wght@600;700&display=block" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;background:#090305;font-family:'Chakra Petch',sans-serif;color:#f6ecdc}
.bg{position:absolute;inset:0;background:url(data:image/jpeg;base64,${banner.toString('base64')}) center/cover}
.tint{position:absolute;inset:0;background:linear-gradient(90deg,rgba(9,3,5,.93) 0%,rgba(9,3,5,.86) 50%,rgba(60,4,6,.25) 100%),radial-gradient(55% 75% at 80% 50%,rgba(255,40,30,.38),transparent 70%)}
.grain{position:absolute;inset:0;opacity:.08;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.left{position:absolute;left:62px;top:52px;width:600px}
.brand{font-family:'Big Shoulders Display';font-weight:900;font-style:italic;font-size:30px;letter-spacing:.01em;display:flex;align-items:center;gap:12px}
.brand b{color:#ffc93a}.brand i{font-style:italic;color:#9a8a80;font-weight:800}
.brand img{width:34px;height:34px;border-radius:8px}
.eyebrow{margin-top:34px;font-weight:700;font-size:17px;letter-spacing:.3em;color:#ff5a3c}
.num{margin-top:8px;font-family:'Big Shoulders Display';font-weight:900;font-size:138px;line-height:.86;letter-spacing:-.005em;
  background:linear-gradient(180deg,#fff8ec 0%,#ffd28c 32%,#ff7a1a 60%,#ff2a2a 88%);-webkit-background-clip:text;color:transparent;
  filter:drop-shadow(0 5px 0 rgba(90,0,0,.6)) drop-shadow(0 0 30px rgba(255,60,30,.35))}
.title{margin-top:10px;font-family:'Big Shoulders Display';font-weight:900;font-size:50px;line-height:.95;text-transform:uppercase;color:#fff}
.meta{margin-top:18px;font-size:22px;font-weight:600;color:#e8d8c6}
.meta em{font-style:normal;color:#9dff4a}
.pill{margin-top:26px;display:inline-flex;align-items:center;gap:10px;height:62px;padding:0 30px;border-radius:999px;background:linear-gradient(180deg,#ffd75a,#ffb21e);color:#1a0d02;font-weight:700;font-size:25px;box-shadow:0 10px 30px rgba(255,170,30,.35),inset 0 1px 0 rgba(255,255,255,.6)}
.url{position:absolute;left:62px;bottom:40px;font-size:19px;font-weight:600;color:#b6a496;letter-spacing:.02em}
.panel{position:absolute;right:56px;top:62px;width:470px;height:470px;border-radius:22px;border:2px solid #d9a441;overflow:hidden;
  background:linear-gradient(180deg,rgba(40,8,10,.92),rgba(14,4,6,.96));box-shadow:0 30px 70px rgba(0,0,0,.7),0 0 60px rgba(255,40,30,.25)}
.ph{position:absolute;left:24px;top:22px;right:24px;display:flex;justify-content:space-between;align-items:baseline}
.ph span{font-weight:700;font-size:14px;letter-spacing:.24em;color:#ff7a4a}
.peak{position:absolute;left:24px;top:52px;font-family:'Big Shoulders Display';font-weight:900;font-size:64px;line-height:1;color:#fff}
.peak small{font-size:26px;color:#ffb070;margin-left:6px}
.peakl{position:absolute;left:26px;top:118px;font-size:15px;font-weight:600;color:#cdbcac}
.chart{position:absolute;left:24px;top:150px}
.axis{position:absolute;left:24px;right:24px;top:380px;display:flex;justify-content:space-between;font-size:13px;color:#9a8a80;font-weight:600}
.pf{position:absolute;left:24px;right:24px;bottom:22px;padding-top:14px;border-top:1px solid rgba(255,150,110,.2);display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:#e8d8c6}
.pf b{color:#ffb070}
.zero{position:absolute;left:24px;bottom:20px;display:flex;gap:10px}
.zero span{padding:6px 12px;border-radius:999px;border:1.5px solid rgba(157,255,74,.55);color:#9dff4a;font-weight:700;font-size:14px;letter-spacing:.12em}
.disc{position:absolute;right:40px;top:40px;width:132px;height:132px;border-radius:50%;background:#000;border:5px solid #f6ecdc;box-shadow:0 12px 30px rgba(0,0,0,.7);display:grid;place-items:center;overflow:hidden}
.disc img{width:118%;height:118%;object-fit:cover}
.spooks{position:absolute;inset:0;font-size:26px;opacity:.55}
.spooks span{position:absolute}
</style></head><body>
<div class="bg"></div><div class="tint"></div>
<div class="spooks"><span style="left:600px;top:40px">🦇</span><span style="left:655px;top:96px;font-size:18px">🦇</span><span style="left:560px;top:556px;font-size:22px">🎃</span></div>
<div class="left">
  <div class="brand"><img src="data:image/png;base64,${skull}"><span>TOKEN<b>BLASTER</b><i>.LOL</i></span></div>
  <div class="eyebrow">BSV STRESS TEST · 31 OCT 2026</div>
  <div class="num">9,183,007</div>
  <div class="title">transactions in one day</div>
  <div class="meta">20 TERRORNODE bots · <em>0 rejected</em> · <em>0 orphaned</em></div>
  <div class="pill">💀 Read the report</div>
</div>
<div class="url">tokenblaster.lol/stresstest</div>
<div class="panel">
  <div class="ph"><span>TX / SEC · 31 OCT</span></div>
  <div class="peak">2,604<small>tx/s</small></div>
  <div class="peakl">fastest second · the storm, minute by minute</div>
  <svg class="chart" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff3a2a" stop-opacity=".85"/><stop offset="1" stop-color="#ff3a2a" stop-opacity=".05"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${CW}" y1="${CH * f}" y2="${CH * f}" stroke="rgba(255,150,110,.14)" stroke-dasharray="3 6"/>`).join('')}
    ${paths.map((p) => `<path d="${p.area}" fill="url(#g)"/><path d="${p.line}" fill="none" stroke="#ff8a4a" stroke-width="2" stroke-linejoin="round"/>`).join('')}
    <line x1="0" x2="${CW}" y1="${CH}" y2="${CH}" stroke="rgba(255,150,110,.35)"/>
  </svg>
  <div class="axis"><span>12:00</span><span>14:00</span><span>16:00</span><span>18:00 UTC</span></div>
  <div class="pf"><span>Best minute <b>≈ 1,600 tx/s</b></span><span>Typical accept <b>≈ 1 s</b></span></div>
</div>
<div class="disc"><img src="data:image/png;base64,${skull}"></div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--force-color-profile=srgb'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: 'png' });
await browser.close();
let q = 88, jpg;
do { jpg = await sharp(png).jpeg({ quality: q, mozjpeg: true }).toBuffer(); q -= 4; } while (jpg.length > 300_000 && q > 50);
writeFileSync(out, jpg);
console.log(`${out}: ${(jpg.length / 1024).toFixed(0)} KB (q ${q + 4})`);
