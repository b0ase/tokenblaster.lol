import assert from 'node:assert/strict';
import test from 'node:test';
import { BUYBACK_MIN, bookBroadcastBurn, burnStats, buybackSpend } from './launch/burn';
import { price, quoteBuy } from './launch/curve';

test('buyback waits for the threshold', () => {
  assert.equal(buybackSpend(0, BUYBACK_MIN - 1), 0);
  assert.ok(buybackSpend(0, BUYBACK_MIN) > 0);
});

test('buyback never spends more than free minus the fee margin', () => {
  const s = buybackSpend(500_000_000, 150_000);
  assert.equal(s, 148_000);
});

test('one buyback moves the price by at most ~2%', () => {
  for (const reserve of [0, 50_000_000, 283_000_000]) {
    // sold that matches this reserve: walk the curve with one buy
    const sold = reserve ? quoteBuy(BigInt(0), BigInt(Math.ceil(reserve / 0.99))).soldAfter : BigInt(0);
    const spend = buybackSpend(reserve, 10_000_000_000);
    const q = quoteBuy(sold, BigInt(spend));
    const move = price(q.soldAfter) / price(sold) - 1;
    assert.ok(move > 0 && move <= 0.021, `move ${move} at reserve ${reserve}`);
  }
});

test('burn stats', () => {
  const s = burnStats(10_000_000);
  assert.equal(s.pct, 1);
  assert.equal(s.supplyNow, 990_000_000);
  assert.equal(burnStats(-5).burned, 0);
});

test('booking a broadcast burn retries, then fails loudly with the txid', async () => {
  let n = 0;
  await bookBroadcastBurn('ab', async () => {
    if (++n < 3) throw new Error('ledger down');
  }, 3, 1);
  assert.equal(n, 3);
  await assert.rejects(
    bookBroadcastBurn('deadbeef', async () => {
      throw new Error('lease lost');
    }, 2, 1),
    /BURN BROADCAST BUT NOT BOOKED deadbeef: lease lost/,
  );
});
