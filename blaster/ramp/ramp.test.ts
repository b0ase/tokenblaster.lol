/** Ramp tooling against the local mock ARC / BSV Broadcaster. No network, no keys. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { arcBroadcaster, bsvBroadcaster, classify, followEvents, CALLBACK_TOKEN, type TxItem } from './broadcaster';
import { Ledger, op } from './ledger';
import { Mock } from './mock';
import { runRamp, stopReason, estimate, type StageStats } from './runner';
import { signer, txidHex, parseTx } from './tx';

const fakeTxid = () => txidHex(randomBytes(32));

function blasts(n: number) {
  const s = signer(randomBytes(32));
  const base = fakeTxid();
  return Array.from({ length: n }, (_, i) => { const t = s.blast({ txid: base, vout: i, value: 1000 }, i, 'test', 100); return { txid: t.txid, bytes: t.ef } as TxItem; });
}

function setup(o: { coins?: number; coinValue?: number } = {}) {
  const sign = signer(randomBytes(32));
  const ledger = new Ledger();
  const fund = fakeTxid();
  for (let i = 0; i < (o.coins ?? 20); i++) ledger.addMined(fund, i, o.coinValue ?? 200 * 28 + 2000);
  return { sign, ledger };
}

test('tx: EF parses back to the same txid as the raw tx', () => {
  const s = signer(randomBytes(32));
  const f = s.fanOut([{ txid: fakeTxid(), vout: 0, value: 100_000 }, { txid: fakeTxid(), vout: 3, value: 50_000 }], [500, 500, 500], 'test', 100);
  assert.equal(parseTx(f.ef).tx.txid, f.txid);
  assert.equal(parseTx(f.raw).tx.txid, f.txid);
  const b = s.blast({ txid: f.txid, vout: 1, value: 500 }, 1, 'test', 100);
  assert.equal(parseTx(b.ef).tx.txid, b.txid);
  assert.deepEqual(parseTx(b.ef).tx.inputs, [{ txid: f.txid, vout: 1 }]);
});

test('ledger: never re-spends, only spends SEEN/MINED, caps depth at 2', () => {
  const L = new Ledger();
  L.addMined('a'.repeat(64), 0, 10_000);
  const k = op('a'.repeat(64), 0);
  L.spend('f1', [k], [0, 100, 100]);
  assert.throws(() => L.spend('f2', [k], [50]), /re-spend refused/);
  assert.throws(() => L.spend('b1', ['f1:1'], [0, 99]), /unsettled/);
  L.settle('f1', 'seen');
  assert.equal(L.count('seen'), 2);
  L.spend('b1', ['f1:1'], [0, 99]);
  L.settle('b1', 'seen');
  assert.throws(() => L.spend('b2', ['b1:1'], [0, 98]), /too deep/);
  assert.equal(L.available('seen').length, 1); // f1:2 only; b1:1 is too deep
  L.settle('b1', 'mined');
  assert.equal(L.available('mined').length, 1); // mined resets depth
});

test('ledger: missing inputs kills the chain and releases its mined root once', () => {
  const L = new Ledger();
  L.addMined('a'.repeat(64), 0, 10_000);
  L.spend('f1', [op('a'.repeat(64), 0)], [0, 100, 100]);
  L.settle('f1', 'seen');
  L.spend('b1', ['f1:1'], [0, 99]);
  // Parent still alive by its broadcaster: only the child dies.
  assert.deepEqual(L.missingInputs('b1', () => false), []);
  assert.equal(L.txs.get('b1')!.state, 'dead');
  assert.equal(L.count('seen'), 1);
  // Parent confirmed REJECTED: it dies too (and its other lane), the mined coin comes back once.
  L.spend('b2', ['f1:2'], [0, 99]);
  assert.deepEqual(L.missingInputs('b2', (id) => id === 'f1'), [op('a'.repeat(64), 0)]);
  assert.equal(L.txs.get('f1')!.state, 'dead');
  assert.equal(L.count('seen'), 0);
  assert.equal(L.count('mined'), 1);
  L.spend('f1b', [op('a'.repeat(64), 0)], [0, 100]);
  assert.throws(() => L.spend('f1c', [op('a'.repeat(64), 0)], [0, 100]), /re-spend/);
});

test('classify: only SEEN/MINED settle; orphan + missing inputs are told apart', () => {
  assert.equal(classify({ txStatus: 'ANNOUNCED_TO_NETWORK' }), 'unsettled');
  assert.equal(classify({ txStatus: 'SEEN_IN_ORPHAN_MEMPOOL' }), 'unsettled');
  assert.equal(classify({ txStatus: 'SEEN_ON_NETWORK' }), 'seen');
  assert.equal(classify({ txStatus: 'SEEN_MULTIPLE_NODES' }), 'seen');
  assert.equal(classify({ txStatus: 'ACCEPTED_BY_NETWORK' }), 'unsettled');
  assert.equal(classify({ txStatus: 'ACCEPTED_BY_NETWORK' }, true), 'seen');
  assert.equal(classify({ txStatus: 'IMMUTABLE' }), 'mined');
  assert.equal(classify({ txStatus: 'REJECTED', extraInfo: 'arc error 463: missing inputs' }), 'orphan-dead');
  assert.equal(classify({ txStatus: 'REJECTED', extraInfo: 'fee too low' }), 'rejected');
  assert.equal(classify({ txStatus: 'NOT_FOUND' }), 'unknown');
});

for (const kind of ['bsv', 'arc'] as const) {
  test(`${kind}: 503 backs off and re-sends the SAME bytes, tagged with the callback token`, async () => {
    const m = new Mock({ fail503: 2 });
    const url = await m.start();
    try {
      const bc = kind === 'bsv' ? bsvBroadcaster(url, { backoffMs: 5 }) : arcBroadcaster(url, { backoffMs: 5 });
      const items = blasts(5);
      const r = await bc.submit(items);
      assert.deepEqual(r.map((x) => x.outcome), Array(5).fill('accepted'));
      assert.equal(m.bodies.length, 3);
      assert.equal(new Set(m.bodies.map((b) => b.sha)).size, 1, 'resends are byte-identical');
      assert.deepEqual([...m.tokens], [CALLBACK_TOKEN]);
      const st = await bc.status(items[0].txid);
      assert.ok(st && ['RECEIVED', 'SEEN_ON_NETWORK'].includes(st.txStatus));
    } finally { await m.stop(); }
  });

  for (const named of [true, false]) {
    test(`${kind}: a 400 batch is isolated (bad txid ${named ? 'named' : 'not named → bisect'}); the good txs still go`, async () => {
      const items = blasts(37);
      const bad = new Set([items[5].txid, items[30].txid]);
      const m = new Mock({ reject: bad, nameBadTxid: named, arcWhole400: true });
      const url = await m.start();
      try {
        const bc = kind === 'bsv' ? bsvBroadcaster(url) : arcBroadcaster(url);
        const r = await bc.submit(items);
        const rej = r.filter((x) => x.outcome === 'rejected').map((x) => x.txid).sort();
        assert.deepEqual(rej, [...bad].sort());
        assert.equal(r.filter((x) => x.outcome === 'accepted').length, 35);
        assert.equal(m.txs.size, 35);
      } finally { await m.stop(); }
    });
  }
}

test('bsv: batches split by maxBatch', async () => {
  const m = new Mock();
  const url = await m.start();
  try {
    const r = await bsvBroadcaster(url, { maxBatch: 10 }).submit(blasts(25));
    assert.equal(r.filter((x) => x.outcome === 'accepted').length, 25);
    assert.equal(m.bodies.length, 3);
  } finally { await m.stop(); }
});

test('bsv: no answer after every resend → "retry" (caller keeps the bytes)', async () => {
  const m = new Mock({ busy: () => true });
  const url = await m.start();
  try {
    const r = await bsvBroadcaster(url, { backoffMs: 1, tries: 3 }).submit(blasts(3));
    assert.deepEqual(r.map((x) => x.outcome), ['retry', 'retry', 'retry']);
    assert.equal(new Set(m.bodies.map((b) => b.sha)).size, 1);
  } finally { await m.stop(); }
});

test('policy + health on both kinds', async () => {
  const m = new Mock({ satsPerKb: 50 });
  const url = await m.start();
  try {
    assert.equal((await bsvBroadcaster(url).policy()).satsPerKb, 50);
    assert.equal((await arcBroadcaster(url).policy()).satsPerKb, 50);
    assert.equal((await bsvBroadcaster(url).health()).ok, true);
  } finally { await m.stop(); }
});

test('SSE: /events statuses reach followEvents', async () => {
  const m = new Mock({ seenAfterMs: 10 });
  const url = await m.start();
  const ac = new AbortController();
  try {
    const items = blasts(3);
    await bsvBroadcaster(url).submit(items);
    const seen = new Set<string>();
    const done = followEvents(url, (s) => { if (s.txStatus === 'SEEN_ON_NETWORK') seen.add(s.txid); }, { signal: ac.signal });
    const end = Date.now() + 3000;
    while (seen.size < 3 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await done;
    assert.equal(seen.size, 3);
  } finally { await m.stop(); }
});

for (const kind of ['bsv', 'arc'] as const) {
  test(`${kind} ramp: parents first, no re-spend, every stage logged`, async () => {
    const m = new Mock({ seenAfterMs: 40 });
    const url = await m.start();
    try {
      const { sign, ledger } = setup();
      const budget = { maxSats: 1e9, spent: 0 };
      const bc = kind === 'bsv' ? bsvBroadcaster(url) : arcBroadcaster(url);
      const r = await runRamp({ bc, ledger, sign, run: 'test', stages: [100, 200], stageSecs: 1.5, satsPerKb: 100, fanWidth: 200, leadSecs: 1, pollMs: 50, statusSample: 1, budget, halted: () => false, minPace: 0.5 });
      assert.equal(r.stages.length, 2, `stopped: ${r.stop}`);
      assert.deepEqual(m.violations, [], 'no child before its parent was SEEN');
      assert.deepEqual(m.doubleSpends, []);
      for (const s of r.stages) { assert.equal(s.acceptRate, 1); assert.equal(s.orphan, 0); assert.ok(s.seen > 0); }
      assert.ok(r.stages[1].sent > r.stages[0].sent);
      assert.ok(budget.spent > 0);
    } finally { await m.stop(); }
  });
}

test('ramp: orphans that die "missing inputs" are counted and stop the climb', async () => {
  let blastCount = 0;
  const m = new Mock({ seenAfterMs: 20, orphanDeadMs: 50, orphan: () => ++blastCount % 10 === 0 });
  const url = await m.start();
  try {
    const { sign, ledger } = setup();
    const r = await runRamp({ bc: bsvBroadcaster(url), ledger, sign, run: 'test', stages: [100, 200, 300], stageSecs: 1, satsPerKb: 100, fanWidth: 200, leadSecs: 1, pollMs: 50, statusSample: 1, budget: { maxSats: 1e9, spent: 0 }, halted: () => false, minPace: 0.3, fanSettleMs: 3000 });
    assert.equal(r.stages.length, 1);
    assert.ok(r.stages[0].orphan > 0);
    assert.match(r.stop ?? '', /orphan\/rejected/);
    const dead = [...ledger.txs.values()].filter((t) => t.state === 'dead');
    assert.ok(dead.length > 0, 'missing-inputs txs are dead in the ledger');
  } finally { await m.stop(); }
});

test('ramp: auto-stop when the accept rate falls under 95 %', async () => {
  let on = false;
  const m = new Mock({ seenAfterMs: 20, reject: (txid) => on && parseInt(txid.slice(0, 2), 16) % 5 === 0 });
  const url = await m.start();
  try {
    const { sign, ledger } = setup();
    const r = await runRamp({
      bc: bsvBroadcaster(url), ledger, sign, run: 'test', stages: [100, 200, 300, 400], stageSecs: 1, satsPerKb: 100, fanWidth: 200, leadSecs: 1, pollMs: 50, statusSample: 0.2,
      budget: { maxSats: 1e9, spent: 0 }, halted: () => false, minPace: 0.3, log: (s) => { if (s.includes('stage 2/')) on = true; },
    });
    assert.equal(r.stages.length, 2);
    assert.match(r.stop ?? '', /accept rate/);
  } finally { await m.stop(); }
});

test('ramp: max-sats cap stops it', async () => {
  const m = new Mock({ seenAfterMs: 20 });
  const url = await m.start();
  try {
    const { sign, ledger } = setup();
    const budget = { maxSats: 3000, spent: 0 };
    const r = await runRamp({ bc: bsvBroadcaster(url), ledger, sign, run: 'test', stages: [200, 400], stageSecs: 2, satsPerKb: 100, fanWidth: 200, leadSecs: 1, pollMs: 50, budget, halted: () => false });
    assert.match(r.stop ?? '', /max-sats/);
    assert.ok(budget.spent <= 3000);
  } finally { await m.stop(); }
});

test('ramp: a halt (STOP file / SIGINT) ends a long stage within 10 s', async () => {
  const m = new Mock({ seenAfterMs: 20 });
  const url = await m.start();
  try {
    const { sign, ledger } = setup();
    let halted = false;
    setTimeout(() => { halted = true; }, 500);
    const t0 = Date.now();
    const r = await runRamp({ bc: bsvBroadcaster(url), ledger, sign, run: 'test', stages: [100, 200], stageSecs: 300, satsPerKb: 100, fanWidth: 200, leadSecs: 1, pollMs: 50, budget: { maxSats: 1e9, spent: 0 }, halted: () => halted });
    assert.ok(Date.now() - t0 < 10_000, `took ${Date.now() - t0} ms`);
    assert.match(r.stop ?? '', /halted/);
  } finally { await m.stop(); }
});

test('stopReason rules', () => {
  const base: StageStats = { run: 'x', stage: 1, target: 100, secs: 300, sent: 30000, accepted: 30000, rejected: 0, retryPending: 0, sampled: 600, seen: 600, orphan: 0, sampleRejected: 0, txps: 100, acceptRate: 1, badRate: 0, latencyP50: 0, latencyP95: 0, latencyMax: 0, fanouts: 15, feesSats: 0 };
  assert.equal(stopReason(base, undefined), undefined);
  assert.match(stopReason({ ...base, acceptRate: 0.94 }, base)!, /accept rate/);
  assert.match(stopReason({ ...base, badRate: 0.02 }, base)!, /orphan/);
  assert.match(stopReason({ ...base, txps: 50 }, base)!, /keep up/);
});

test('estimate: full ramp at 100 sat/kB', () => {
  const e = estimate({ satsPerKb: 100, sign: signer(randomBytes(32)) });
  assert.equal(e.blasts, 1_605_000);
  assert.ok(e.blastFee >= 20 && e.blastFee <= 30, `blast fee ${e.blastFee}`);
});
