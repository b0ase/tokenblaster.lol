import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, Transaction } from '@bsv/sdk';
import { runLanes, unfiredOf, type Out, type UnfiredLane } from './stormCore';
import { SPARE_BASE, decodeSpare, encodeSpare, mergeSpare, spareRounds, takeSpare } from './spareLanes';
import { LANE_SLACK } from './gallery';

const key = PrivateKey.fromRandom(); // throwaway: never funded, nothing leaves this process
const priv = Uint8Array.from(key.toArray('be', 32));
const A = 'ab'.repeat(32);
const B = 'cd'.repeat(32);
const lane = (txid: string, vout: number, sats = 62): UnfiredLane => ({ txid, vout, sats });

test('spare lanes: stored as runs, read back exactly', () => {
  const lanes = [...[0, 1, 2, 3, 7, 9, 10].map((v) => lane(A, v)), lane(B, 4, 33), lane(B, 5, 33)];
  const recs = encodeSpare(lanes);
  assert.deepEqual(recs.find((r) => r.t === A)?.r, [0, 3, 7, 7, 9, 10]);
  assert.deepEqual(recs.find((r) => r.t === B)?.r, [4, 5]);
  const back = decodeSpare(JSON.parse(JSON.stringify(recs)));
  assert.deepEqual(new Set(back.map((l) => `${l.txid}_${l.vout}_${l.sats}`)), new Set(lanes.map((l) => `${l.txid}_${l.vout}_${l.sats}`)));
  assert.deepEqual(decodeSpare([{ t: 'not a txid', s: 62, r: [0, 1] }, null, 7]), []);
  assert.deepEqual(decodeSpare('junk'), []);
});

test('spare lanes: merge keeps one per outpoint and never a spent one', () => {
  const out = mergeSpare([lane(A, 0), lane(A, 1)], [lane(A, 1), lane(A, 2), lane(A, 3, 0)], new Set([`${A}_2`]));
  assert.deepEqual(out.map((l) => l.vout), [0, 1]);
});

test('spare lanes: take covers the rounds asked for, skips spent and dust, numbers bases clear of a load', () => {
  const each = 2 * 30 + LANE_SLACK;
  assert.equal(spareRounds(each, 30), 2);
  assert.equal(spareRounds(31, 30), 1);
  assert.equal(spareRounds(30, 30), 0);
  const spare = [lane(A, 0, each), lane(A, 1, each), lane(A, 2, 20), lane(B, 5, each), lane(B, 6, each), lane(A, 3, each)];
  const t = takeSpare(spare, 5, 30, new Set([`${A}_1`]));
  assert.equal(t.rounds, 5);
  assert.deepEqual(t.taken.map((l) => `${l.txid.slice(0, 2)}_${l.vout}`), ['ab_0', 'cd_5', 'cd_6']);
  assert.deepEqual(t.lanes.map((l) => l.count), [2, 2, 1]);
  assert.deepEqual(t.rest.map((l) => l.vout), [3]);
  assert.ok(t.bases.every((b) => b.i >= SPARE_BASE));
  for (const l of t.lanes) {
    const b = t.bases.find((x) => x.i === l.base)!;
    assert.equal(b.values[l.vout], each);
  }
  // Less spare than asked: everything usable, and the rounds it really carries.
  const all = takeSpare(spare, 100, 30, new Set());
  assert.equal(all.rounds, 10);
  assert.equal(all.rest.length, 0);
});

/** Mock broadcaster: every POST answered SEEN_ON_NETWORK; records each posted tx. */
function mockArc() {
  const txs: Transaction[] = [];
  const f = (async (url: string, init: { method?: string; body: string }) => {
    if (init.method !== 'POST') return { status: 200, json: async () => ({ txid: url.split('/').pop(), txStatus: 'SEEN_ON_NETWORK' }) } as unknown as Response;
    const body = JSON.parse(init.body) as { rawTx: string }[];
    const out = body.map((b) => {
      const tx = Transaction.fromHexEF(b.rawTx);
      txs.push(tx);
      return { txid: tx.id('hex'), txStatus: 'SEEN_ON_NETWORK' };
    });
    return { status: 200, json: async () => out } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, txs };
}
const inputsOf = (txs: Transaction[]) => new Set(txs.map((t) => `${t.inputs[0].sourceTXID}_${t.inputs[0].sourceOutputIndex}`));

test('sender: a stopped storm names exactly the lanes it never fired, and none it spent', async () => {
  const arc = mockArc();
  const outs: Out[] = [];
  const lanes = 1500;
  await runLanes(
    {
      priv,
      token: 'sats',
      baseTxid: A,
      baseValues: Array.from({ length: lanes }, () => 62),
      lanes: Array.from({ length: lanes }, (_, i) => ({ vout: i, count: 2, n: i * 2 + 1 })),
      game: 'gallery',
      arcs: ['http://mock-arc.invalid'],
      maxDepth: 2,
    },
    // Stop once the first POSTs are out: most lanes were never fired.
    { stopped: () => arc.txs.length >= 600, paused: () => false, emit: (o) => outs.push(o), fetch: arc.f, pollMs: 1 },
  );
  const reported = outs.filter((o): o is Extract<Out, { type: 'unfired' }> => o.type === 'unfired').flatMap((o) => o.lanes);
  const spent = inputsOf(arc.txs);
  const firedLanes = [...spent].filter((k) => k.startsWith(A)).length;
  assert.ok(firedLanes > 0 && reported.length > 0, `fired ${firedLanes}, unfired ${reported.length}`);
  for (const l of reported) assert.ok(!spent.has(`${l.txid}_${l.vout}`), `reported lane ${l.vout} was spent`);
  assert.equal(new Set(reported.map((l) => l.vout)).size, reported.length);
  assert.equal(firedLanes + reported.length, lanes, 'every lane is either fired or reported');
  assert.ok(reported.every((l) => l.txid === A && l.sats === 62));
});

test('sender: a storm that fired everything reports nothing; a paused one reports every lane', async () => {
  const done = mockArc();
  const outs: Out[] = [];
  const base = { priv, token: 'sats', baseTxid: A, baseValues: [62, 62, 62], lanes: [0, 1, 2].map((v) => ({ vout: v, count: 2, n: v * 2 + 1 })), arcs: ['http://mock-arc.invalid'], maxDepth: 2 };
  await runLanes(base, { stopped: () => false, paused: () => false, emit: (o) => outs.push(o), fetch: done.f, pollMs: 1 });
  assert.equal(done.txs.length, 6);
  assert.ok(!outs.some((o) => o.type === 'unfired'));

  const idle = mockArc();
  const held: Out[] = [];
  let ticks = 0;
  await runLanes(base, { stopped: () => ++ticks > 20, paused: () => true, emit: (o) => held.push(o), fetch: idle.f, pollMs: 1 });
  assert.equal(idle.txs.length, 0);
  const u = held.find((o): o is Extract<Out, { type: 'unfired' }> => o.type === 'unfired');
  assert.deepEqual(u?.lanes.map((l) => l.vout).sort(), [0, 1, 2]);
});

test('sender: streamed lanes that arrived but were never taken in are reported too', async () => {
  const arc = mockArc();
  const outs: Out[] = [];
  const pending = [{ bases: [{ i: 1, txid: B, values: [0, 0, 62, 62] }], lanes: [2, 3].map((v) => ({ base: 1, vout: v, count: 2, n: 100 + v })) }];
  let ticks = 0;
  await runLanes(
    { priv, token: 'sats', baseTxid: '', baseValues: [], lanes: [], arcs: ['http://mock-arc.invalid'], maxDepth: 2 },
    // Stopped before the loop ever takes the pending batch in.
    { stopped: () => ++ticks > 0, paused: () => false, emit: (o) => outs.push(o), fetch: arc.f, pollMs: 1, more: () => pending.splice(0), open: () => true },
  );
  const u = outs.find((o): o is Extract<Out, { type: 'unfired' }> => o.type === 'unfired');
  assert.deepEqual(u?.lanes, [lane(B, 2), lane(B, 3)]);
  // Token-burn lanes are never handed back this way.
  assert.deepEqual(unfiredOf([{ bases: [{ i: 0, txid: A, values: [62] }], lanes: [{ vout: 0, count: 1, n: 1, tok: { vout: 1, amt: '1' } }] }]), []);
});
