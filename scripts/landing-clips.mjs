#!/usr/bin/env node
/**
 * Records the landing hero's footage deck: short, silent 720p gameplay clips of the arcade games, captured from
 * headless Chrome's CDP screencast against a running dev server, then encoded with ffmpeg into
 * public/landing/clips/<id>.mp4 (+ <id>.jpg poster). Practice mode only: no wallet, no transactions.
 *
 *   pnpm dev -p 3492            # in another terminal (dev: the autopilot hooks only exist under next dev)
 *   node scripts/landing-clips.mjs [--base http://localhost:3492] [--only bracer,arena] [--secs 7] [--keep]
 *
 * Needs: Google Chrome (or CHROME=/path/to/chrome), ffmpeg on PATH. Uses `ws` from devDependencies.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((x) => x.length));
const BASE = typeof args.base === 'string' ? args.base : 'http://localhost:3492';
const SECS = Number(args.secs) || 7;
const ONLY = typeof args.only === 'string' ? args.only.split(',') : null;
const OUT = resolve('public/landing/clips');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1280, H = 720;
/** The emulated viewport: the clip height plus GameShell's 56 px bar, so a 16:9 stage lands at exactly 1280x720. */
const VH = H + 56;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VK = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32, Enter: 13, Escape: 27, ShiftLeft: 16, KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, KeyF: 70, KeyV: 86, KeyJ: 74, KeyK: 75, KeyZ: 90, KeyX: 88, KeyC: 67 };
const KEY = { ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Space: ' ', Enter: 'Enter', Escape: 'Escape', ShiftLeft: 'Shift', KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f', KeyV: 'v', KeyJ: 'j', KeyK: 'k', KeyZ: 'z', KeyX: 'x', KeyC: 'c' };

/** Pre-load script for every game: no fullscreen jumps, no first-run prompts, city prologue seen. */
const PRELUDE = `
  try { localStorage.setItem('tb-auto-fullscreen', '0'); localStorage.setItem('tb-preview-sound', '0'); localStorage.setItem('tb.audio', JSON.stringify({ muted: true, music: 0, sfx: 0 }));
        localStorage.setItem('tokenblaster:city-story', JSON.stringify({ seen: ['prologue'], done: [], standing: {}, evidence: { genius: 0, conman: 0, spook: 0 } })); } catch {}
  Element.prototype.requestFullscreen = () => Promise.resolve();
  // pointer lock cannot be granted headless; a stub that 'succeeds' leaves games waiting for a lock that never comes (Double-O pauses), so refuse it
  Element.prototype.requestPointerLock = () => Promise.reject(new Error('headless'));
`;
/** Canvas only: the game's DOM HUD, the shell bar and the page text go invisible. Tiny canvases (minimaps) too. */
const CANVAS_ONLY = `
  (() => { const s = document.createElement('style'); s.textContent = 'body *{visibility:hidden!important} [data-game-shell] canvas{visibility:visible!important} body{background:#000}'; document.head.appendChild(s);
    for (const c of document.querySelectorAll('[data-game-shell] canvas')) { const r = c.getBoundingClientRect(); if (r.width < 400) c.style.setProperty('visibility', 'hidden', 'important'); } })()
`;

/** click the first enabled <button> whose text matches re; returns true if found */
const clickExpr = (re) => `(() => { const b = [...document.querySelectorAll('button')].find((x) => ${re}.test(x.textContent || '') && !x.disabled); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`;

// One recipe per game: how to start, how to keep it lively. `drive` runs for the whole recording.
const GAMES = [
  { id: 'bracer', url: '/arcade/bracer', title: 'bRacer', start: async (p) => { await p.clickWhen(/RACE\s*·\s*PRACTICE/i); await sleep(5500); await p.eval('window.__bracer && (window.__bracer.autopilot = true)'); }, drive: async (p) => { await p.hold('ShiftLeft', 1200); await sleep(1800); } },
  { id: 'arena', url: '/arena?noauto&showcase', title: 'Arena', start: async (p) => { await p.waitFor("document.body.textContent.includes('TRY IT NOW')", 40000); await p.eval("window.dispatchEvent(new CustomEvent('arena:enter',{detail:{practice:true}}))"); await sleep(1500); }, drive: async (p) => { p.down('KeyW'); p.down('Space'); await sleep(900); p.up('Space'); await p.hold('ArrowRight', 500); await sleep(400); p.down('Space'); await sleep(800); p.up('Space'); await p.hold('ArrowLeft', 450); p.up('KeyW'); await sleep(300); } },
  { id: 'doubleo', url: '/arcade/doubleosatoshi', title: 'Double-O Satoshi', start: async (p) => { await p.clickWhen(/PLAY PRACTICE/i, 60000); await sleep(2500); await p.clickWhen(/SKIP/i, 15000); await sleep(1500); /* the briefing's GO drops into the co-op lobby: ready up, start now, countdown */ await p.waitFor("(() => { const b = document.querySelector('[data-ready]'); if (!b) return false; b.click(); return true; })()", 15000); await sleep(400); await p.eval("document.querySelector('[data-start-match]')?.click()"); const running = () => p.eval('!!(window.__doubleo && window.__doubleo.state().running)'); await p.waitFor('!!(window.__doubleo && window.__doubleo.state().running)', 20000).catch(() => undefined); await sleep(4200); /* the SAT countdown */ console.log(`  doubleo running: ${await running()}`); await p.hold('ArrowLeft', 1400); }, drive: async (p) => { p.down('KeyW'); p.down('Space'); await sleep(600); p.up('Space'); await p.hold('ArrowLeft', 350); await sleep(500); p.down('Space'); await sleep(600); p.up('Space'); await p.hold('ArrowRight', 300); await sleep(400); p.up('KeyW'); await p.hold('ArrowLeft', 500); } },
  { id: 'rally', url: '/arcade/rally', title: 'Token Rally', start: async (p) => { await p.clickWhen(/START STAGE/i); await sleep(4500); await p.eval('window.__rally && window.__rally.setAutopilot && window.__rally.setAutopilot(true)'); }, drive: async (p) => { await p.hold('ShiftLeft', 900); await sleep(2000); } },
  { id: 'city', url: '/arcade/city?gfx=high', title: 'Satoshi City', start: async (p) => { await p.clickWhen(/ENTER\s*·\s*PRACTICE/i, 60000); await sleep(2500); await p.tap('Escape'); await sleep(800); await p.eval('window.__tbCity && window.__tbCity.toCar && window.__tbCity.toCar()'); await sleep(900); await p.tap('KeyF'); await sleep(1500); await p.tap('KeyF'); await sleep(1200); await p.tap('KeyV'); await sleep(300); }, drive: async (p) => { p.down('KeyW'); await sleep(1600); await p.hold('KeyA', 500); await sleep(900); await p.hold('KeyD', 500); p.up('KeyW'); await sleep(200); } },
  { id: 'npg-arena', url: '/arcade/npg-arena?demo', title: 'NPG Arena', start: async (p) => { await p.waitFor("!!document.querySelector('[data-game-shell] canvas')", 60000); await sleep(9000); }, drive: async () => { await sleep(1000); } },
  { id: 'frogger', url: '/arcade/frogger', title: 'Chain Frogger', start: async (p) => { await p.waitFor("!!document.querySelector('[data-game-shell] canvas')", 60000); await sleep(2500); await p.feed(40); await p.tap('ArrowUp'); await sleep(600); }, drive: async (p) => { await p.feed(10); await p.tap('ArrowUp'); await sleep(500); await p.tap(Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight'); await sleep(400); await p.tap('Space'); await sleep(500); await p.tap('ArrowUp'); await sleep(600); } },
  { id: 'bsvgun', url: '/arcade/bsvgun', title: 'BSVGun', start: async (p) => { await p.clickWhen(/START/i, 60000); await sleep(2500); }, drive: async (p) => { const x = 200 + Math.random() * 880, y = 160 + Math.random() * 380; await p.mouse(x, y); await sleep(120); await p.mouse(x + 40, y - 20); await sleep(80); p.down('Space'); await sleep(90); p.up('Space'); await sleep(260); } },
  { id: 'invaders', url: '/arcade/invaders', title: 'Mempool Invaders', start: async (p) => { await p.clickWhen(/PRACTICE/i, 60000); await sleep(1500); }, drive: async (p) => { p.down('Space'); await p.hold('ArrowLeft', 500 + Math.random() * 500); await sleep(150); await p.hold('ArrowRight', 500 + Math.random() * 600); p.up('Space'); await sleep(120); } },
  { id: 'snake', url: '/arcade/snake', title: 'Token Snake', start: async (p) => { await p.clickWhen(/PRACTICE/i, 60000); await sleep(1500); }, drive: async (p) => { await p.tap(['ArrowLeft', 'ArrowRight'][(Math.random() * 2) | 0]); await sleep(900 + Math.random() * 900); } },
  { id: 'hopper', url: '/arcade/hopper', title: 'Block Hopper', start: async (p) => { await p.clickWhen(/PRACTICE/i, 60000); await sleep(800); await p.eval('window.__hopper && (window.__hopper.autoplay = true)'); await sleep(800); }, drive: async () => { await sleep(1000); } },
  { id: 'highway21', url: '/arcade/highway21', title: 'Highway 21M', start: async (p) => { await p.clickWhen(/PRACTICE/i, 60000); await sleep(1200); }, drive: async (p) => { p.down('ArrowUp'); await p.hold(['ArrowLeft', 'ArrowRight'][(Math.random() * 2) | 0], 300 + Math.random() * 300); await sleep(700); await p.hold('Space', 600); p.up('ArrowUp'); await sleep(100); } },
  { id: 'npg-runner', url: '/arcade/npg-runner', title: 'NPG: Erobot Uprising', start: async (p) => { await p.clickWhen(/PRACTICE/i, 60000); await sleep(1500); }, drive: async (p) => { p.down('ArrowRight'); await sleep(600); await p.tap('Space'); await sleep(500); await p.tap('KeyJ'); await sleep(400); await p.tap('ShiftLeft'); await sleep(500); p.up('ArrowRight'); await sleep(150); } },
  { id: 'kweg', url: '/arcade/kweg', title: "Kweg's Expedition", start: async (p) => { await p.clickWhen(/BEGIN/i, 60000); await sleep(1500); await p.tap('Enter'); await sleep(1500); }, drive: async (p) => { await p.hold('ArrowRight', 700); await p.hold(['ArrowUp', 'ArrowDown'][(Math.random() * 2) | 0], 500); await p.tap('Space'); await sleep(300); await p.hold('KeyX', 300); await sleep(200); } },
];

/** Minimal CDP client on the browser websocket, talking to one page target with flat sessions. */
class Page {
  constructor(ws, sessionId) { this.ws = ws; this.sid = sessionId; this.id = 0; this.pending = new Map(); this.frames = []; this.onFrame = null; }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId: this.sid }));
    });
  }
  handle(msg) {
    if (msg.id && this.pending.has(msg.id)) { const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id); if (msg.error) rej(new Error(msg.error.message)); else res(msg.result); return; }
    if (msg.method === 'Page.screencastFrame' && this.onFrame) this.onFrame(msg.params);
  }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.value; }
  async waitFor(expr, ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await this.eval(expr).catch(() => false)) return true; await sleep(250); } throw new Error(`timeout waiting for ${expr}`); }
  async clickWhen(re, ms = 45000) { return this.waitFor(clickExpr(re), ms); }
  key(type, code) { return this.send('Input.dispatchKeyEvent', { type, code, key: KEY[code] ?? code, windowsVirtualKeyCode: VK[code] ?? 0, nativeVirtualKeyCode: VK[code] ?? 0, text: code === 'Space' ? ' ' : undefined }); }
  down(code) { return this.key('keyDown', code); }
  up(code) { return this.key('keyUp', code); }
  async tap(code) { await this.down(code); await sleep(60); await this.up(code); }
  async hold(code, ms) { await this.down(code); await sleep(ms); await this.up(code); }
  mouse(x, y) { return this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
  /** dev-only: inject fake live transactions so feed-driven games (Frogger) have traffic */
  async feed(n) {
    await this.eval(`for (let i = 0; i < ${n}; i++) { const hex = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join(''); const kinds = ['payment','payment','token','data','inscription','social','blast']; window.dispatchEvent(new CustomEvent('tokenblaster:test-tx', { detail: { id: hex, kind: kinds[(Math.random()*kinds.length)|0], bytes: 200 + ((Math.random()*4000)|0), sats: 1000 + ((Math.random()*5e6)|0), mined: false, at: Date.now() } })); }`);
  }
}

async function launchChrome() {
  const dir = join(tmpdir(), `tb-clips-${Date.now()}`);
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--window-size=${W},${VH}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-device-scale-factor=1', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
    proc.on('exit', (c) => rej(new Error(`chrome exited ${c}\n${buf}`)));
    setTimeout(() => rej(new Error('chrome did not start')), 20000);
  });
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  return { proc, ws, dir };
}

async function record(ws, game) {
  const sessions = new Map();
  const browserPending = new Map();
  let bid = 0;
  const bsend = (method, params = {}) => new Promise((res, rej) => { const id = ++bid; browserPending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const onMsg = (raw) => {
    const msg = JSON.parse(raw);
    if (msg.sessionId && sessions.has(msg.sessionId)) return sessions.get(msg.sessionId).handle(msg);
    if (msg.id && browserPending.has(msg.id)) { const { res, rej } = browserPending.get(msg.id); browserPending.delete(msg.id); if (msg.error) rej(new Error(msg.error.message)); else res(msg.result); }
  };
  ws.on('message', onMsg);
  const { targetId } = await bsend('Target.createTarget', { url: 'about:blank', newWindow: true, width: W, height: VH });
  const { sessionId } = await bsend('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(ws, sessionId);
  sessions.set(sessionId, page);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: VH, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE });
  await page.send('Page.navigate', { url: BASE + game.url });
  await page.waitFor("document.readyState === 'complete'", 60000);
  await sleep(1500);
  await game.start(page);
  await page.eval(CANVAS_ONLY);
  await page.eval('window.scrollTo(0, 0)');
  await sleep(300);
  // the game canvas, clipped to the viewport (the start click can scroll the stage)
  const rect = await page.eval(`(() => { let best = null; for (const c of document.querySelectorAll('[data-game-shell] canvas')) { const r = c.getBoundingClientRect(); const x = Math.max(0, r.left), y = Math.max(0, r.top), w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y; if (w >= 400 && h >= 200 && (!best || w * h > best.w * best.h)) best = { x, y, w, h }; } return best; })()`);
  console.log(`  canvas ${rect ? `${Math.round(rect.w)}x${Math.round(rect.h)} @ ${Math.round(rect.x)},${Math.round(rect.y)}` : 'not found'} (viewport ${await page.eval('innerWidth')}x${await page.eval('innerHeight')})`);

  // screencast
  const frameDir = join(tmpdir(), `tb-frames-${game.id}`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  const frames = [];
  page.onFrame = (f) => {
    frames.push({ t: f.metadata.timestamp, n: frames.length });
    writeFileSync(join(frameDir, `f${String(frames.length - 1).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    page.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  };
  await page.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: VH, everyNthFrame: 1 });
  const t0 = Date.now();
  let alive = true;
  const driver = (async () => { while (alive) await game.drive(page); })();
  while (Date.now() - t0 < SECS * 1000 + 600) await sleep(100);
  alive = false;
  await page.send('Page.stopScreencast');
  page.onFrame = null;
  await driver.catch(() => undefined);
  await bsend('Target.closeTarget', { targetId }).catch(() => undefined);
  ws.off('message', onMsg);
  return { frames, frameDir, rect };
}

function run(cmd, argv) {
  return new Promise((res, rej) => { const p = spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'] }); p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`)))); });
}

async function encode(game, { frames, frameDir, rect }) {
  if (frames.length < 20) throw new Error(`${game.id}: only ${frames.length} frames`);
  // Variable-rate frames → concat list with real durations (skip the first 0.6 s: settling after the HUD hide)
  const start = frames[0].t + 0.6;
  const lines = [];
  for (let i = 0; i < frames.length - 1; i++) {
    if (frames[i].t < start) continue;
    const d = Math.min(0.25, Math.max(0.01, frames[i + 1].t - frames[i].t));
    lines.push(`file '${join(frameDir, `f${String(i).padStart(5, '0')}.jpg`)}'`, `duration ${d.toFixed(4)}`);
  }
  const list = join(frameDir, 'list.txt');
  writeFileSync(list, lines.join('\n') + '\n');
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, `${game.id}.mp4`), jpg = join(OUT, `${game.id}.jpg`);
  // crop to the game canvas (a 16:9 window inside it when its shape differs), then 1280x720
  let crop = '';
  if (rect) {
    let { x, y, w, h } = rect;
    if (w / h > W / H + 0.02) { const nw = h * (W / H); x += (w - nw) / 2; w = nw; }
    else if (w / h < W / H - 0.02) { const nh = w / (W / H); y += (h - nh) / 2; h = nh; }
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    crop = `crop=${even(w)}:${even(h)}:${Math.round(Math.max(0, x))}:${Math.round(Math.max(0, y))},`;
  }
  await run('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-t', String(SECS), '-vf', `${crop}scale=${W}:${H}:flags=lanczos,format=yuv420p,fps=30`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-profile:v', 'high', '-movflags', '+faststart', '-an', mp4]);
  await run('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-ss', '1.0', '-i', mp4, '-frames:v', '1', '-q:v', '4', jpg]);
  const fps = (frames.length / (frames[frames.length - 1].t - frames[0].t)).toFixed(1);
  console.log(`${game.id}: ${frames.length} frames @ ~${fps} fps → ${(statSync(mp4).size / 1e6).toFixed(2)} MB`);
  if (!args.keep) rmSync(frameDir, { recursive: true, force: true });
}

const main = async () => {
  const todo = GAMES.filter((g) => !ONLY || ONLY.includes(g.id));
  const { proc, ws, dir } = await launchChrome();
  try {
    for (const g of todo) {
      try {
        console.log(`▶ ${g.id} ${BASE}${g.url}`);
        const rec = await record(ws, g);
        await encode(g, rec);
      } catch (e) {
        console.error(`✗ ${g.id}: ${e.message}`);
      }
    }
  } finally {
    ws.close();
    proc.kill();
    await sleep(500);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* chrome still flushing its profile */ }
  }
  if (existsSync(OUT)) {
    const total = readdirSync(OUT).filter((f) => f.endsWith('.mp4')).reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
    console.log(`clips total: ${(total / 1e6).toFixed(1)} MB in ${OUT}`);
  }
};
main().catch((e) => { console.error(e); process.exit(1); });
