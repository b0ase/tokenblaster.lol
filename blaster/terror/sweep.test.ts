/** TERRORNODE sweep: run selection, lane picking and fee maths. No network, no keys. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAME, TAG, signer, toHex, txidHex } from '../ramp/tx';
import { opReturn } from '../../src/lib/fastBlast';
import { INPUT_BYTES, inputCost, journalSpentFor, lanesOf, listRuns, pickRuns, planSweep, pool, txOutputs } from './sweep';

test('sweep: only finished runs; newest unfinished never, older unfinished only by --include', () => {
  const d = mkdtempSync(join(tmpdir(), 'sweep-'));
  const mk = (name: string, done: boolean) => {
    mkdirSync(join(d, name));
    writeFileSync(join(d, name, 'fanouts.txt'), `terrornode-bot01 ${'a'.repeat(64)}\njunk\n`);
    if (done) writeFileSync(join(d, name, 'summary.json'), '{}');
  };
  mk('live-2026-10-31T01-00-00-000Z', true);
  mk('live-2026-10-31T02-00-00-000Z', false);
  mk('live-2026-10-31T03-00-00-000Z', false);
  mkdirSync(join(d, 'dry-2026-10-31T04-00-00-000Z'));
  const runs = listRuns(d);
  assert.equal(runs.length, 3);
  assert.equal(runs[0].fanouts.length, 1);
  let p = pickRuns(runs);
  assert.deepEqual(p.swept.map((r) => r.name), ['live-2026-10-31T01-00-00-000Z']);
  assert.equal(p.skipped.length, 2);
  p = pickRuns(runs, ['live-2026-10-31T02-00-00-000Z', 'live-2026-10-31T03-00-00-000Z']);
  assert.deepEqual(p.swept.map((r) => r.name), ['live-2026-10-31T01-00-00-000Z', 'live-2026-10-31T02-00-00-000Z']);
  assert.match(p.skipped[0].why, /newest/);
});

test('sweep: lanes come from the fan-out itself (our P2PKH, below max-coin), journals drop spent ones', async () => {
  const s = signer(randomBytes(32));
  const fund = { txid: txidHex(randomBytes(32)), vout: 0, value: 1_000_000 };
  const fan = s.fanOut([fund], [40, 40, 40], 'terrornode-bot01', 100);
  const outs = txOutputs(fan.raw);
  assert.equal(outs.length, 5); // tag, 3 lanes, change
  const lanes = lanesOf(fan.txid, fan.raw, toHex(s.lock), 10_000);
  assert.deepEqual(lanes.map((c) => [c.vout, c.value]), [[1, 40], [2, 40], [3, 40]]); // change (≥ 10k) left alone
  assert.equal(lanesOf(fan.txid, fan.raw, '76a914' + '00'.repeat(20) + '88ac', 10_000).length, 0);

  const d = mkdtempSync(join(tmpdir(), 'sweepj-'));
  writeFileSync(join(d, 'spent-terrornode-bot01.jsonl'), `S ${fan.txid}:1 x\nS ${'b'.repeat(64)}:0 z\n`);
  writeFileSync(join(d, 'spent-sweep.jsonl'), `S ${fan.txid}:2 y\nR ${fan.txid}:2\nR ${fan.txid}:1\n`); // sweep's R never frees a bot's spend
  const spent = await journalSpentFor(d, new Set([fan.txid]));
  assert.deepEqual([...spent], [`${fan.txid}:1`]);
});

test('sweep: fee at 100 sat/kB, uneconomic lanes skipped, tx size capped, fee matches the signer', () => {
  assert.equal(INPUT_BYTES, 148);
  assert.equal(inputCost(100), 14.8);
  const t = txidHex(randomBytes(32));
  const coins = [...Array.from({ length: 12 }, (_, i) => ({ txid: t, vout: i, value: 40 })), { txid: t, vout: 99, value: 14 }];
  const p = planSweep(coins, 100, { maxInputs: 5 });
  assert.equal(p.uneconomic.length, 1);
  assert.equal(p.txs.length, 3);
  assert.deepEqual(p.txs.map((x) => x.inputs.length), [5, 5, 2]);
  for (const x of p.txs) {
    assert.equal(x.fee, Math.ceil((x.bytes * 100) / 1000) + 1);
    assert.equal(x.out, x.inValue - x.fee);
  }
  assert.equal(p.out + p.fees, 12 * 40);

  const s = signer(randomBytes(32));
  const big = Array.from({ length: 3000 }, (_, i) => ({ txid: t, vout: i, value: 40 }));
  const tagLen = opReturn([TAG, 'sats', 'fan', GAME, 'terrornode-sweep']).length;
  const q = planSweep(big, 100, { maxInputs: 5000, bytesFor: (k) => s.fanBytes(k, 1, tagLen) });
  assert.equal(q.txs.length, 1);
  const signed = s.fanOut(q.txs[0].inputs, [], 'terrornode-sweep', 100);
  assert.equal(signed.fee, q.txs[0].fee);
  assert.ok(signed.raw.length <= q.txs[0].bytes && q.txs[0].bytes < 1_000_000);
  assert.equal(signed.outputs.length, 2); // tag + one coin back
});

test('sweep: pool keeps ≤ limit in flight and stops on demand', async () => {
  let now = 0, peak = 0, ran = 0;
  await pool(Array.from({ length: 10 }), 2, async () => { now++; peak = Math.max(peak, now); ran++; await new Promise((r) => setTimeout(r, 5)); now--; });
  assert.equal(peak, 2);
  assert.equal(ran, 10);
  ran = 0;
  await pool(Array.from({ length: 10 }), 2, async () => { ran++; }, () => ran >= 3);
  assert.ok(ran <= 4);
});
