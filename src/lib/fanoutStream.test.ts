/**
 * Streamed ammo (31 Oct 2026): the leaf fan-outs go out in small groups after the root, play starts once the first
 * leaf is SEEN, and later lanes reach the running sender. No network and no money: a mock broadcaster, throwaway keys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction } from '@bsv/sdk';
import { fanoutPlan, SPLIT_OUTPUTS } from './gallery';
import { buildLeaf, leafLanes, streamLeaves, type LaneSpec } from './fanoutStream';
import { runLanes, type AddMsg, type Broadcaster, type Out, type TxResult } from './stormCore';
import { watchdogStep, type WatchState } from './sfx';

const key = PrivateKey.fromRandom(); // throwaway: never funded
const address = key.toAddress();

async function rootFor(total: number, perBlast: number) {
  const plan = fanoutPlan(total, perBlast);
  const fund = new Transaction();
  fund.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: plan.need + 10_000 });
  const root = new Transaction();
  root.addInput({ sourceTransaction: fund, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(key) });
  plan.sizes.forEach((k, i) => root.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: k * plan.each + plan.leafFee[i] }));
  root.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
  await root.fee(new SatoshisPerKilobyte(100));
  await root.sign();
  return { plan, root };
}

/** Mock broadcaster: each POST answers after `ms`; `seen(txid)` decides SEEN vs held. Logs every event in order. */
function mockBc(ms: number, seen: (txid: string) => boolean = () => true) {
  const events: string[] = [];
  const posts: string[][] = [];
  let bytes = 0;
  let maxBody = 0;
  const bc: Broadcaster = {
    kind: 'arc',
    url: 'mock',
    async post(efs, txids) {
      const body = efs.reduce((n, e) => n + e.length * 2, 0);
      bytes += body;
      maxBody = Math.max(maxBody, body);
      posts.push(txids);
      for (const t of txids) events.push(`post:${t}`);
      await new Promise((r) => setTimeout(r, ms));
      return txids.map((txid): TxResult => ({ txid, txStatus: seen(txid) ? 'SEEN_ON_NETWORK' : 'STORED' }));
    },
    async status(txid) {
      return { txid, txStatus: seen(txid) ? 'SEEN_ON_NETWORK' : 'STORED' };
    },
  };
  return { bc, events, posts, stats: () => ({ bytes, maxBody }) };
}

test('leafLanes: every round once, in the old order, at most LANE_DEPTH a lane', () => {
  const total = 12_345;
  const plan = fanoutPlan(total, 120);
  let sum = 0;
  const seen = new Set<string>();
  for (let i = 0; i < plan.leaves; i++)
    for (const l of leafLanes(plan, total, i)) {
      assert.ok(l.count >= 1 && l.count <= plan.perLane);
      assert.ok(!seen.has(`${l.base}_${l.vout}`));
      seen.add(`${l.base}_${l.vout}`);
      sum += l.count;
    }
  assert.equal(sum, total);
});

test('streamed leaves: GO after ONE leaf, a leaf is POSTed only after its root output is marked spent, each lane handed over once', async () => {
  const total = 40_000; // 20,000 lanes = 8 leaves
  const { plan, root } = await rootFor(total, 120);
  assert.equal(plan.leaves, 8);
  const m = mockBc(5);
  const spent: string[] = [];
  const got: LaneSpec[] = [];
  const order: string[] = [];
  const st = streamLeaves({
    root,
    plan,
    total,
    key,
    address: address,
    bc: m.bc,
    seenMs: 1000,
    pollMs: 1,
    cancelled: () => false,
    onSpent: (op) => {
      spent.push(op);
      order.push(`spent:${op}`);
    },
    onReady: (bases, lanes) => {
      for (const b of bases) order.push(`ready:${b.i}`);
      got.push(...lanes);
    },
  });
  const first = await st.first;
  assert.equal(first, SPLIT_OUTPUTS, 'GO once the first leaf (2,500 lanes) is seen');
  assert.equal(m.posts[0].length, 1, 'the first POST is one leaf');
  const r = await st.done;
  assert.equal(r.unseen.length, 0);
  assert.equal(got.reduce((n, l) => n + l.count, 0), total, 'every round handed over');
  assert.equal(new Set(got.map((l) => `${l.base}_${l.vout}`)).size, got.length, 'each lane once');
  assert.equal(spent.length, plan.leaves);
  assert.ok(m.posts.every((p) => p.length <= 8), 'small groups, never one huge POST');
  // The first lanes were handed over before the last leaf was even built.
  assert.ok(order.indexOf('ready:0') < order.indexOf(`spent:${root.id('hex')}_${plan.leaves - 1}`));
});

test('a leaf the network never sees is never handed over (no lane spends an unseen parent)', async () => {
  const total = 20_000; // 4 leaves
  const { plan, root } = await rootFor(total, 120);
  let bad = '';
  const m = mockBc(1, (txid) => txid !== bad);
  bad = (await buildLeaf(root, plan, key, address, 2)).txid; // deterministic signing: same txid when streamed
  const got: LaneSpec[] = [];
  const st = streamLeaves({ root, plan, total, key, address, bc: m.bc, seenMs: 30, pollMs: 1, cancelled: () => false, onSpent: () => undefined, onReady: (_, l) => got.push(...l) });
  const r = await st.done;
  assert.deepEqual(r.unseen, [2]);
  assert.ok(!got.some((l) => l.base === 2));
  assert.equal(got.length, plan.lanes - plan.sizes[2]);
});

test('cancel stops the feed: no more leaves are built or POSTed', async () => {
  const total = 60_000; // 12 leaves
  const { plan, root } = await rootFor(total, 120);
  const m = mockBc(5);
  let stop = false;
  const st = streamLeaves({ root, plan, total, key, address, bc: m.bc, seenMs: 1000, pollMs: 1, cancelled: () => stop, onSpent: () => undefined, onReady: () => undefined });
  await st.first;
  stop = true;
  await st.done;
  const posted = m.posts.flat().length;
  assert.ok(posted < plan.leaves, `stopped after ${posted} of ${plan.leaves}`);
});

test('worker protocol: lanes added after start are fired; the sender waits while open, ends after end', async () => {
  const lanes = 30;
  const values = Array.from({ length: lanes }, () => 2 * 120 + 5);
  const posted: string[] = [];
  const f = (async (_u: string, init: { method?: string; body: string }) => {
    if (init.method !== 'POST') return { status: 200, json: async () => ({ txStatus: 'SEEN_ON_NETWORK' }) } as unknown as Response;
    const body = JSON.parse(init.body) as { rawTx: string }[];
    const out = body.map((b) => {
      const tx = Transaction.fromHexEF(b.rawTx);
      posted.push(tx.inputs[0].sourceTXID ?? tx.inputs[0].sourceTransaction!.id('hex'));
      return { txid: tx.id('hex'), txStatus: 'SEEN_ON_NETWORK' };
    });
    return { status: 200, json: async () => out } as unknown as Response;
  }) as unknown as typeof fetch;
  const queue: AddMsg[] = [];
  let open = true;
  const outs: Out[] = [];
  const A = 'aa'.repeat(32);
  const B = 'bb'.repeat(32);
  const done = runLanes(
    { priv: Uint8Array.from(key.toArray('be', 32)), token: 'sats', baseTxid: '', baseValues: [], lanes: [], maxN: 4 * lanes + 1, arcs: ['http://mock.invalid'], maxDepth: 2 },
    { stopped: () => false, paused: () => false, emit: (o) => outs.push(o), fetch: f, pollMs: 1, more: () => queue.splice(0), open: () => open },
  );
  queue.push({ bases: [{ i: 0, txid: A, values }], lanes: Array.from({ length: lanes }, (_, j) => ({ base: 0, vout: j, count: 2, n: 1 + 2 * j })) });
  await new Promise((r) => setTimeout(r, 200));
  const afterFirst = posted.length;
  assert.equal(afterFirst, lanes * 2, 'first batch fully fired while the sender is still open');
  queue.push({ bases: [{ i: 1, txid: B, values }], lanes: Array.from({ length: lanes }, (_, j) => ({ base: 1, vout: j, count: 2, n: 1 + 2 * (lanes + j) })) });
  await new Promise((r) => setTimeout(r, 200));
  open = false;
  await done;
  assert.equal(posted.length, lanes * 4, 'the added batch fired too');
  assert.equal(posted.filter((p) => p === B).length, lanes, 'each added lane coin spent once');
});

test('music watchdog: resumes a suspended context, replays a paused deck, skips a stalled one, idles when muted', () => {
  const base: WatchState = { wanted: true, ctx: 'running', ctxRan: true, hasSrc: true, paused: false, ended: false, t: 10, lastT: 9, stuck: 0 };
  assert.equal(watchdogStep(base).act, 'none');
  assert.equal(watchdogStep({ ...base, ctx: 'suspended' }).act, 'resume-ctx');
  assert.equal(watchdogStep({ ...base, ctx: 'suspended', ctxRan: false }).act, 'none', 'never before a gesture unlocked it');
  assert.equal(watchdogStep({ ...base, paused: true }).act, 'play');
  assert.equal(watchdogStep({ ...base, ended: true }).act, 'advance');
  let s = { ...base, t: 5, lastT: 5 };
  const acts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = watchdogStep(s);
    acts.push(r.act);
    s = { ...s, stuck: r.stuck };
  }
  assert.deepEqual(acts, ['none', 'none', 'advance'], 'clock frozen 3 s: next track');
  assert.equal(watchdogStep({ ...base, wanted: false, paused: true }).act, 'none');
});
