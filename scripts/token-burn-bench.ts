/**
 * Token-burn throughput bench (coin ammo, 25 Oct 2026): the storm's burn mode (src/lib/stormCore.ts runLanes with
 * `burn`, signing with src/lib/fastBlast.ts) against a MOCK ARC, split over worker threads the way the browser
 * splits lanes over storm workers. Nothing touches the network or a real key: the key is fresh and never funded,
 * the lane coins spend a made-up parent, nothing is broadcast.
 *
 *   pnpm tsx scripts/token-burn-bench.ts                          1, 25 and 100 lanes, all cores but one
 *   pnpm tsx scripts/token-burn-bench.ts --cores 3 --rtt 400 --per-tx 0.3 --per-lane 400
 *
 * Mock ARC answers each POST after `rtt + perTx × batch` ms with SEEN_ON_NETWORK for every tx (GorillaPool's real
 * latency is an input here, not a measurement). Reports burns/s accepted from the first burn to the last.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { P2PKH, PrivateKey } from '@bsv/sdk';
import { BURN_ADDRESS } from '../src/lib/gun';
import { runLanes } from '../src/lib/stormCore';

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const ID = `${'ab'.repeat(32)}_0`;

type Job = { priv: number[]; lanes: number; mine: number[]; perLane: number; rtt: number; perTx: number };

async function work(j: Job) {
  const mock = (async (_u: string, init: { body: string }) => {
    const n = (init.body.match(/rawTx/g) ?? []).length;
    await new Promise((r) => setTimeout(r, j.rtt + j.perTx * n));
    const out = Array.from({ length: n }, () => ({ txStatus: 'SEEN_ON_NETWORK' }));
    return { status: 200, json: async () => out } as unknown as Response;
  }) as unknown as typeof fetch;
  let sent = 0;
  const t0 = performance.now();
  const baseValues = [...Array.from({ length: j.lanes }, () => 1), ...Array.from({ length: j.lanes }, () => j.perLane * 90 + 50)];
  await runLanes(
    {
      priv: Uint8Array.from(j.priv),
      baseTxid: 'cd'.repeat(32),
      baseValues,
      lanes: j.mine.map((i) => ({ vout: j.lanes + i, count: j.perLane, n: i * j.perLane + 1, tok: { vout: i, amt: String(j.perLane) } })),
      step: 100,
      game: 'terrornode',
      extra: ['b0asex@bwalletx.com'],
      arcs: ['http://mock-arc.invalid'],
      burn: { id: ID, per: '1', toLockHex: new P2PKH().lock(BURN_ADDRESS).toHex() },
    },
    { stopped: () => false, paused: () => false, emit: (o) => void (o.type === 'sent' && (sent += o.n)), fetch: mock },
  );
  return { sent, ms: performance.now() - t0 };
}

if (!isMainThread) {
  void work(workerData as Job).then((r) => parentPort!.postMessage(r));
} else {
  const cores = arg('cores', Math.max(1, availableParallelism() - 1));
  const perLane = arg('per-lane', 400);
  const rtt = arg('rtt', 300);
  const perTx = arg('per-tx', 0.3);
  const priv = Array.from(PrivateKey.fromRandom().toArray('be', 32));
  void (async () => {
    console.log(`token-burn bench: ${perLane} burns/lane, mock ARC ${rtt} ms + ${perTx} ms/tx, up to ${cores} worker threads`);
    for (const lanes of [1, 25, 100]) {
      const w = Math.max(1, Math.min(lanes, cores));
      const t0 = performance.now();
      const counts = await Promise.all(
        Array.from({ length: w }, (_, k) => {
          const mine = Array.from({ length: lanes }, (_, i) => i).filter((i) => i % w === k);
          return new Promise<{ sent: number; ms: number }>((ok, no) => {
            const wk = new Worker(__filename, { workerData: { priv, lanes, mine, perLane, rtt, perTx } satisfies Job, execArgv: ['--import', 'tsx'] });
            wk.once('message', (r: { sent: number; ms: number }) => (ok(r), void wk.terminate()));
            wk.once('error', no);
          });
        }),
      );
      const sent = counts.reduce((a, b) => a + b.sent, 0);
      const secs = (performance.now() - t0) / 1000;
      // Sending time: from each worker's first burn to its last (worker start-up under tsx is not part of the game).
      const send = Math.max(...counts.map((c) => c.ms)) / 1000;
      console.log(JSON.stringify({ lanes, workers: w, burns: sent, sendSecs: +send.toFixed(2), burnsPerSec: Math.round(sent / send), wallSecs: +secs.toFixed(2) }));
    }
  })();
}
