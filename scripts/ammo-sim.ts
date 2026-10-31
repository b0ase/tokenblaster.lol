/**
 * Simulated big TERRORNODE load (no network, no money): a mock broadcaster, a throwaway key.
 * `pnpm tsx --expose-gc scripts/ammo-sim.ts [rounds] [old|new]`: time to GO, longest main-thread block, heap peak.
 * old = every leaf built, ONE POST, all SEEN, then each storm worker parses every leaf (as before 31 Oct 2026).
 * new = src/lib/fanoutStream.ts (GO after the first leaf, the rest streamed in the background).
 * `... new slow [ms]`: the 31 Oct network: ARC stuck at ANNOUNCED_TO_NETWORK, Arcade SEEN `ms` after a POST
 * (default 360000 = 6 min), through the same dual status the gun uses. The old 1.2 s mock could never fail.
 */
import { P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction } from '@bsv/sdk';
import { fanoutPlan } from '../src/lib/gallery';
import { streamLeaves } from '../src/lib/fanoutStream';
import { dualBroadcaster, settleTxs, type Broadcaster } from '../src/lib/stormCore';

const rounds = Number(process.argv[2] ?? 357_154);
const mode = process.argv[3] ?? 'new';
const key = PrivateKey.fromRandom();
const address = key.toAddress();
const plan = fanoutPlan(rounds, 120);

// ARC-ish: ~1.2 s to SEEN (X-WaitFor) plus upload time for the body at ~2 MB/s (a phone uplink is slower).
const fast: Broadcaster = {
  kind: 'arc',
  url: 'mock',
  async post(efs, txids) {
    const body = efs.reduce((n, e) => n + e.length * 2, 0);
    JSON.stringify(efs.map((e) => Buffer.from(e).toString('hex'))); // the JSON body is built, as in the real POST
    await new Promise((r) => setTimeout(r, 1200 + body / 2000));
    return txids.map((txid) => ({ txid, txStatus: 'SEEN_ON_NETWORK' }));
  },
  async status(txid) {
    return { txid, txStatus: 'SEEN_ON_NETWORK' };
  },
};

const slowMs = Number(process.argv[5] ?? 360_000);
const postedAt = new Map<string, number>();
const arcStuck: Broadcaster = {
  kind: 'arc',
  url: 'mock-arc',
  async post(_efs, txids) {
    return txids.map((txid) => ({ txid, txStatus: 'ANNOUNCED_TO_NETWORK' }));
  },
  async status(txid) {
    return { txid, txStatus: 'ANNOUNCED_TO_NETWORK' };
  },
};
const arcadeSlow: Broadcaster = {
  kind: 'arcade',
  url: 'mock-arcade',
  async post(_efs, txids) {
    for (const t of txids) if (!postedAt.has(t)) postedAt.set(t, Date.now());
    return txids.map((txid) => ({ txid, txStatus: 'RECEIVED' }));
  },
  async status(txid) {
    const t = postedAt.get(txid);
    return t === undefined ? null : { txid, txStatus: Date.now() - t >= slowMs ? 'SEEN_ON_NETWORK' : 'RECEIVED' };
  },
};
const bc: Broadcaster = process.argv[4] === 'slow' ? dualBroadcaster(arcadeSlow, arcStuck) : fast;

let heapPeak = 0;
let maxBlock = 0;
let last = performance.now();
const mon = setInterval(() => {
  const now = performance.now();
  maxBlock = Math.max(maxBlock, now - last - 10);
  last = now;
  heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
}, 10);
const gc = (globalThis as { gc?: () => void }).gc;

async function main() {
  gc?.();
  const heap0 = process.memoryUsage().heapUsed;
  const fund = new Transaction();
  fund.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: plan.need + 10_000 });
  const root = new Transaction();
  root.addInput({ sourceTransaction: fund, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(key) });
  plan.sizes.forEach((k, i) => root.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: k * plan.each + plan.leafFee[i] }));
  root.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
  await root.fee(new SatoshisPerKilobyte(100));
  await root.sign();
  const t0 = performance.now();
  await bc.post([Uint8Array.from(root.toEF())], [root.id('hex')]); // root SEEN
  let go = 0;
  let all = 0;
  if (mode === 'old') {
    const leafTxs: Transaction[] = [];
    for (let i = 0; i < plan.leaves; i++) {
      const leaf = new Transaction();
      leaf.addInput({ sourceTransaction: root, sourceOutputIndex: i, unlockingScriptTemplate: new P2PKH().unlock(key) });
      for (let j = 0; j < plan.sizes[i]; j++) leaf.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: plan.each });
      leaf.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
      await leaf.fee(new SatoshisPerKilobyte(100));
      await leaf.sign();
      leafTxs.push(leaf);
      await new Promise((r) => setTimeout(r, 0)); // PR #196's yield
    }
    await settleTxs(bc, leafTxs.map((t) => ({ ef: Uint8Array.from(t.toEF()), txid: t.id('hex') })));
    const bases = leafTxs.map((t) => Transaction.fromHex(t.toHex()));
    const hexes = bases.map((t) => t.toHex());
    go = all = performance.now() - t0;
    // What ONE storm worker then did with moreHex (each of up to 12 workers did the same).
    (globalThis as Record<string, unknown>).__keep = [leafTxs, bases, hexes];
    const parsed = hexes.map((h) => Transaction.fromHex(h));
    (globalThis as Record<string, unknown>).__keep2 = parsed;
    console.log(`old: one worker parsed ${parsed.length} leaves; heap now ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
  } else {
    let lanes = 0;
    const st = streamLeaves({ root, plan, total: rounds, key, address, bc, seenMs: Math.max(60_000, slowMs + 60_000), pollMs: 1000, cancelled: () => false, onSpent: () => undefined, onReady: (_, l) => (lanes += l.length) });
    await st.first;
    go = performance.now() - t0;
    await st.done;
    all = performance.now() - t0;
    console.log(`new: ${lanes} lanes handed over`);
  }
  clearInterval(mon);
  gc?.();
  const retainedMB = Math.round((process.memoryUsage().heapUsed - heap0) / 1e6);
  console.log(
    JSON.stringify({ mode, rounds, leaves: plan.leaves, goSecs: +(go / 1000).toFixed(1), allLoadedSecs: +(all / 1000).toFixed(1), longestBlockMs: Math.round(maxBlock), heapPeakMB: Math.round((heapPeak - heap0) / 1e6), retainedAfterGcMB: retainedMB }),
  );
}
void main();
