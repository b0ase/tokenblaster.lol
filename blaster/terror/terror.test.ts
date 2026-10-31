/** TERRORNODE stress runner: planning maths + a full run against a local mock broadcaster. No network, no keys. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bsvBroadcaster } from '../ramp/broadcaster';
import { Ledger } from '../ramp/ledger';
import { Mock } from '../ramp/mock';
import { signer, txidHex } from '../ramp/tx';
import { ErrorWindow, NO_RECEIPTS, allocate, botName, checkLive, lanesFor, parseBots } from './plan';
import { runStress } from './runner';

test('plan: bot names, bot specs, disjoint coin slices', () => {
  assert.equal(botName(1), 'terrornode-bot01');
  assert.equal(botName(20), 'terrornode-bot20');
  assert.deepEqual(parseBots('3'), [1, 2, 3]);
  assert.deepEqual(parseBots('11-13'), [11, 12, 13]);
  assert.deepEqual(parseBots('2,5'), [2, 5]);
  const coins = Array.from({ length: 1001 }, (_, i) => i);
  const slices = Array.from({ length: 20 }, (_, b) => allocate(coins, 20, b + 1));
  assert.equal(slices.flat().length, 1001);
  assert.equal(new Set(slices.flat()).size, 1001);
  assert.equal(NO_RECEIPTS, true);
});

test('plan: lanes fit the coin, error window trips over 5 %', () => {
  const w = lanesFor(499_500, 30, (k) => 50 + k * 4);
  assert.ok(w * 30 + 50 + w * 4 <= 499_500 && (w + 1) * 30 + 50 + (w + 1) * 4 > 499_500);
  const e = new ErrorWindow(1000, 0.05, 500);
  e.push(480, 20);
  assert.equal(e.check(), undefined);
  e.push(0, 40);
  assert.match(e.check()!, /broadcast errors/);
  assert.match(checkLive({ bots: 20, shotsPerBot: 1_000_000, feePerShot: 29, botMaxSats: 30_000_000, maxSats: 1e9, walletSats: 5e8 })!, /needs/);
  assert.equal(checkLive({ bots: 1, shotsPerBot: 10_000, feePerShot: 29, botMaxSats: 30_000_000, maxSats: 400_000, walletSats: 5e8 }), null);
});

function bots(n: number, coins: number, coinValue: number, bc: (i: number) => ReturnType<typeof bsvBroadcaster>, shots: number, maxSats = 1e9) {
  const fund = txidHex(randomBytes(32));
  const all = Array.from({ length: coins }, (_, i) => ({ txid: fund, vout: i, value: coinValue }));
  return Array.from({ length: n }, (_, i) => {
    const ledger = new Ledger();
    for (const c of allocate(all, n, i + 1)) ledger.addMined(c.txid, c.vout, c.value);
    return { name: botName(i + 1), ledger, bc: bc(i), shots, maxSats };
  });
}

test('runner: 3 bots × 2,000 shots through the mock, wide (≤2 deep), every tx accepted once', async () => {
  const m = new Mock({ seenAfterMs: 20 });
  const url = await m.start();
  try {
    const sign = signer(randomBytes(32));
    const r = await runStress({ bots: bots(3, 9, 40_000, () => bsvBroadcaster(url, { tries: 2 }), 2000), sign, satsPerKb: 100, rate: 0, maxSats: 1e9, fanWidth: 1500, pollMs: 50, fanSettleMs: 5000, statusSample: 0.05, halted: () => false });
    assert.equal(r.stop, undefined);
    assert.equal(r.totals.signed, 6000);
    assert.equal(r.totals.accepted, 6000);
    assert.equal(r.totals.rejected, 0);
    for (const b of r.bots) assert.equal(b.done, 'shots done');
  } finally { await m.stop(); }
});

test('runner: per-bot spend cap stops a bot before it overspends', async () => {
  const m = new Mock({ seenAfterMs: 10 });
  const url = await m.start();
  try {
    const sign = signer(randomBytes(32));
    const r = await runStress({ bots: bots(1, 4, 40_000, () => bsvBroadcaster(url, { tries: 2 }), 5000, 20_000), sign, satsPerKb: 100, rate: 0, maxSats: 1e9, pollMs: 50, fanSettleMs: 5000, halted: () => false });
    assert.ok(r.bots[0].fees <= 20_000, `fees ${r.bots[0].fees}`);
    assert.ok(r.totals.signed < 5000);
    assert.match(r.bots[0].done ?? '', /spend cap/);
  } finally { await m.stop(); }
});

test('runner: kill switch halts the run', async () => {
  const m = new Mock({ seenAfterMs: 10 });
  const url = await m.start();
  try {
    let halted = false;
    setTimeout(() => { halted = true; }, 300);
    const r = await runStress({ bots: bots(1, 50, 40_000, () => bsvBroadcaster(url, { tries: 2 }), 1_000_000), sign: signer(randomBytes(32)), satsPerKb: 100, rate: 500, maxSats: 1e9, pollMs: 50, fanSettleMs: 5000, halted: () => halted });
    assert.match(r.stop ?? '', /halted/);
    assert.ok(r.totals.signed < 1_000_000);
  } finally { await m.stop(); }
});
