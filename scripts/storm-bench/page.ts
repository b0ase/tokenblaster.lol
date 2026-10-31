/**
 * Bench page (bundled by scripts/storm-bench.ts): runs the real storm fan-out (src/lib/stormRun.ts) with the
 * real worker against the bench's mock ARC, and reports accepted tx per second back to the bench.
 */
import { runStorm } from '../../src/lib/stormRun';

type Cfg = { workerUrl: string; baseHex: string; wif: string; lanes: { vout: number; count: number; n: number }[]; step: number; secs: number; arcs: string[]; cores: number };

async function main() {
  const cfg = (await (await fetch('/config')).json()) as Cfg;
  const cores = Math.max(1, Math.min(cfg.lanes.length, cfg.cores || (navigator.hardwareConcurrency || 4) - 1, 12));
  const t0 = performance.now();
  let sent = 0;
  let firstAt = 0;
  const series: number[] = [];
  let lastSec = 0;
  const tick = setInterval(() => {
    series.push(sent - lastSec);
    lastSec = sent;
  }, 1000);
  const why: Record<string, number> = {};
  const res = await runStorm({
    workerUrl: cfg.workerUrl,
    baseHex: cfg.baseHex,
    lanes: cfg.lanes,
    wif: cfg.wif,
    token: 'sats',
    step: cfg.step,
    game: 'terrornode',
    arcs: cfg.arcs,
    cores,
    stop: () => performance.now() - t0 > cfg.secs * 1000,
    paused: () => false,
    onSent: (n) => {
      if (!firstAt) firstAt = performance.now();
      sent = n;
    },
    onWhy: (w) => {
      why[w] = (why[w] ?? 0) + 1;
    },
  });
  clearInterval(tick);
  const secs = (performance.now() - t0) / 1000;
  await fetch('/report', {
    method: 'POST',
    body: JSON.stringify({ cores, hw: navigator.hardwareConcurrency, sent: res.sent, secs, firstMs: firstAt - t0, series, stats: res.stats, why }),
  });
}
main().catch((e) => fetch('/report', { method: 'POST', body: JSON.stringify({ error: String(e?.stack ?? e) }) }));
