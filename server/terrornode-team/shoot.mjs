// Headless screenshots (dev only): node server/terrornode-team/shoot.mjs <url> <out.png> [waitMs] [clickText]
// Launches Chrome headless (never a visible window) with SwiftShader WebGL and drives it over CDP.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const [url, out, wait = '8000', click] = process.argv.slice(2);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tnshot-'))}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900', '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let id = 0;
const pending = new Map();
ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } });
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cmd('Page.enable');
await cmd('Page.navigate', { url });
await sleep(Number(wait));
if (click) {
  await cmd('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase().includes(${JSON.stringify(click.toLowerCase())}))?.click()` });
  await sleep(Number(process.env.AFTER || 6000));
}
const shot = await cmd('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
ws.close();
chrome.kill();
process.exit(0);
