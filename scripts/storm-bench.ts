/**
 * Storm throughput bench: the real browser send path in headless Chrome, against a LOCAL MOCK ARC.
 * Nothing touches the network or a real key: the key is generated fresh and never funded, the "split" tx
 * spends a made-up outpoint, and every POST goes to 127.0.0.1.
 *
 *   pnpm storm:bench                                    new worker, this machine's cores
 *   pnpm storm:bench --worker baseline                  the PR #38 worker (for before/after)
 *   pnpm storm:bench --cores 3 --ecores                 "4-core laptop": 3 workers, Chrome pinned to the M-series
 *                                                       efficiency cores (taskpolicy -c background)
 *   pnpm storm:bench --rtt 400 --per-tx 0.3             mock ARC answers after 400 ms + 0.3 ms per tx
 *   pnpm storm:bench --lanes 100 --step 100 --secs 15
 *
 * Mock ARC answers every tx SEEN_ON_NETWORK after `rtt + perTx * batch` ms (GorillaPool's real batch latency
 * is an input here, not a measurement: see docs/throughput.md for the numbers used).
 */
import { createSecureServer } from 'node:http2';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { build } from 'esbuild';
import { P2PKH, PrivateKey, Script, Transaction } from '@bsv/sdk';
import { STREAM_STEP } from '../src/lib/gallery';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const num = (k: string, d: number) => Number(arg(k, String(d)));

const workerKind = arg('worker', 'new');
const lanesN = num('lanes', 100);
const step = num('step', workerKind === 'baseline' ? 20 : STREAM_STEP);
const secs = num('secs', 12);
const rtt = num('rtt', 250);
const perTx = num('per-tx', 0.2);
const cores = num('cores', 0); // 0: the page's own rule (hardwareConcurrency - 1, max 12)
const ecores = process.argv.includes('--ecores');
const arcsN = num('arcs', 1);
const chrome = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

async function bundle(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', minify: true, write: false });
  return r.outputFiles[0].text;
}

async function main() {
  const workerSrc = await bundle(workerKind === 'baseline' ? 'scripts/storm-bench/baseline-worker.ts' : 'src/workers/storm.ts');
  const pageSrc = await bundle('scripts/storm-bench/page.ts');

  // Throwaway key + a pretend split: lanesN outputs of 1,000,000 sats each. Never broadcast anywhere.
  const key = PrivateKey.fromRandom();
  const split = new Transaction();
  split.addInput({ sourceTXID: 'ab'.repeat(32), sourceOutputIndex: 0, unlockingScript: new Script(), sequence: 0xffffffff });
  for (let i = 0; i < lanesN; i++) split.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 1_000_000 });
  const perLane = 1_000_000; // more than any run can fire: the bench is time-limited
  const lanes = Array.from({ length: lanesN }, (_, i) => ({ vout: i, count: perLane, n: i * perLane + 1 }));

  let report: (v: unknown) => void = () => undefined;
  const done = new Promise<unknown>((r) => (report = r));
  let inflight = 0;
  let maxInflight = 0;
  let posts = 0;
  let bytes = 0;
  // HTTP/2 over TLS like arc.gorillapool.io (HTTP/1.1 would cap Chrome at 6 requests per host, which the real
  // ARC does not). Self-signed cert for 127.0.0.1, made fresh per run.
  const certDir = mkdtempSync(join(tmpdir(), 'storm-bench-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', join(certDir, 'k.pem'), '-out', join(certDir, 'c.pem')], { stdio: 'ignore' });
  const server = createSecureServer({ key: readFileSync(join(certDir, 'k.pem')), cert: readFileSync(join(certDir, 'c.pem')), allowHTTP1: true }, (req, res) => {
    const url = req.url ?? '/';
    if (url === '/') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>storm bench</title><script type="module" src="/page.js"></script>');
    if (url === '/page.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(pageSrc);
    if (url === '/storm-worker.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(workerSrc);
    if (url === '/config') {
      const port = (server.address() as { port: number }).port;
      const arcs = Array.from({ length: arcsN }, (_, i) => `https://127.0.0.1:${port}/arc${i}`);
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ workerUrl: '/storm-worker.js', baseHex: split.toHex(), wif: key.toWif(), lanes, step, secs, arcs, cores }));
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (url === '/report') {
        res.end('ok');
        return report(JSON.parse(body));
      }
      if (/\/v1\/txs$/.test(url) && req.method === 'POST') {
        const txs = JSON.parse(body) as { rawTx: string }[];
        posts++;
        bytes += body.length;
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        setTimeout(() => {
          inflight--;
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(txs.map(() => ({ status: 200, txStatus: 'SEEN_ON_NETWORK' }))));
        }, rtt + perTx * txs.length);
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;

  const profile = mkdtempSync(join(tmpdir(), 'storm-bench-'));
  const cdpPort = 9300 + Math.floor(Math.random() * 500);
  const args = ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--ignore-certificate-errors', '--no-default-browser-check', 'about:blank'];
  const proc = ecores ? spawn('taskpolicy', ['-c', 'background', chrome, ...args], { stdio: 'ignore' }) : spawn(chrome, args, { stdio: 'ignore' });
  try {
    let page: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 50 && !page; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const list = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        page = list.find((t) => t.type === 'page');
      } catch {
        /* chrome still starting */
      }
    }
    if (!page) throw new Error('Chrome did not start');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const cdp = (method: string, params: object = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
    cdp('Page.navigate', { url: `https://127.0.0.1:${port}/` });
    const r = (await Promise.race([done, new Promise((_, no) => setTimeout(() => no(new Error('bench timed out')), (secs + 60) * 1000))])) as {
      error?: string;
      cores: number;
      hw: number;
      sent: number;
      secs: number;
      firstMs: number;
      series: number[];
      stats: { signed: number; posted: number; accepted: number; signMs: number; postMs: number; posts: number };
    };
    ws.close();
    if (r.error) throw new Error(r.error);
    const steady = r.series.slice(2, -1);
    const sustained = steady.length ? Math.round(steady.reduce((a, b) => a + b, 0) / steady.length) : 0;
    const out = {
      worker: workerKind,
      hw: r.hw,
      workers: r.cores,
      ecores,
      lanes: lanesN,
      step,
      rtt,
      perTx,
      arcs: arcsN,
      secs: +r.secs.toFixed(1),
      accepted: r.sent,
      avgTps: Math.round(r.sent / r.secs),
      sustainedTps: sustained,
      peakTps: Math.max(0, ...r.series),
      firstAcceptMs: Math.round(r.firstMs),
      signPerWorkerPerSec: r.stats.signMs ? Math.round((r.stats.signed / r.stats.signMs) * 1000) : null,
      posts,
      maxInflight,
      mbPerSec: +((bytes / 1e6) / r.secs).toFixed(2),
      series: r.series,
    };
    console.log(JSON.stringify(out));
  } finally {
    proc.kill('SIGKILL');
    server.close();
    try {
      rmSync(profile, { recursive: true, force: true });
      rmSync(certDir, { recursive: true, force: true });
    } catch {
      /* temp dir */
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
