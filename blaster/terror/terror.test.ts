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

test('runner: fan-out POSTs capped at --fan-concurrency, bots staggered', async () => {
  const m = new Mock({ seenAfterMs: 10 });
  const url = await m.start();
  try {
    let now = 0, peak = 0;
    const slow = (i: number) => {
      const inner = bsvBroadcaster(url, { tries: 2 });
      return { ...inner, async submit(items: Parameters<typeof inner.submit>[0]) {
        if (items.length !== 1) return inner.submit(items);
        now++; peak = Math.max(peak, now);
        await new Promise((r) => setTimeout(r, 80));
        try { return await inner.submit(items); } finally { now--; }
      } } as ReturnType<typeof bsvBroadcaster>;
    };
    const first = new Map<string, number>();
    const t0 = Date.now();
    const r = await runStress({ bots: bots(6, 12, 40_000, slow, 1500), sign: signer(randomBytes(32)), satsPerKb: 100, rate: 0, maxSats: 1e9, fanWidth: 1500, pollMs: 50, fanSettleMs: 5000,
      fanConcurrency: 2, staggerMs: 60, halted: () => false, onSigned: (b, kind) => { if (kind === 'fan' && !first.has(b)) first.set(b, Date.now() - t0); } });
    assert.equal(r.totals.accepted, 9000);
    assert.ok(peak <= 2, `peak ${peak} fan-out POSTs at once`);
    for (let k = 0; k < 6; k++) assert.ok(first.get(botName(k + 1))! >= k * 60 - 5, `bot ${k + 1} started at ${first.get(botName(k + 1))}`);
  } finally { await m.stop(); }
});

test('runner: a fan-out whose POST got no answer but landed is used, not abandoned', async () => {
  const m = new Mock({ seenAfterMs: 10 });
  const url = await m.start();
  try {
    const lost = (i: number) => {
      const inner = bsvBroadcaster(url, { tries: 2 });
      return { ...inner, async submit(items: Parameters<typeof inner.submit>[0]) {
        const r = await inner.submit(items); // it reaches the server…
        return items.length === 1 ? r.map((x) => ({ txid: x.txid, outcome: 'retry' as const })) : r; // …but the answer is lost
      } } as ReturnType<typeof bsvBroadcaster>;
    };
    const r = await runStress({ bots: bots(2, 4, 40_000, lost, 1000), sign: signer(randomBytes(32)), satsPerKb: 100, rate: 0, maxSats: 1e9, fanWidth: 1000, pollMs: 50, fanSettleMs: 5000, fanTries: 1, halted: () => false });
    assert.equal(r.totals.accepted, 2000);
    assert.equal(r.totals.fanouts, 2);
  } finally { await m.stop(); }
});

test('coins: wallet-wide journal + GorillaPool + WoC, any "spent" skips the coin', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { journalSpent, gorillaSpends, wocSpends, usableCoins } = await import('./coins');
  const P = 'ab'.repeat(32);
  const coins = Array.from({ length: 6 }, (_, v) => ({ txid: P, vout: v, value: 499_986 }));
  const dir = mkdtempSync(join(tmpdir(), 'terror-'));
  writeFileSync(join(dir, 'spent-terrornode-bot01.jsonl'), `S ${P}:0 aa\nS ${P}:5 bb\nR ${P}:5\n`);
  writeFileSync(join(dir, 'spent-terrornode-bot07.jsonl'), `S ${P}:1 cc\n`); // spent under another bot's slice
  const j = journalSpent(dir);
  assert.deepEqual([...j.keys()].sort(), [`${P}:0`, `${P}:1`]);
  const fake = (async (u: string | URL | Request, init?: RequestInit) => {
    const s = String(u);
    if (s.includes('/api/spends')) { const ops = JSON.parse(String(init!.body)) as string[]; return new Response(JSON.stringify(ops.map((o) => (o.endsWith('_2') ? 'dd' : '')))); }
    if (s.endsWith(`/${P}/3/spent`)) return new Response(JSON.stringify({ txid: 'ee' }));
    return new Response('Not Found', { status: 404 });
  }) as typeof fetch;
  const gp = await gorillaSpends(coins, { fetch: fake });
  const woc = await wocSpends(coins, { fetch: fake, perSec: 1000 });
  const r = usableCoins(coins, { journal: j, gorillapool: gp, woc });
  assert.deepEqual(r.usable.map((c) => c.vout), [4, 5]);
  assert.deepEqual(r.skipped.map((s) => [s.coin.vout, s.by.join('+')]), [[0, 'journal'], [1, 'journal'], [2, 'gorillapool'], [3, 'woc']]);
});
