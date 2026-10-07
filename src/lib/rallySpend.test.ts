import assert from 'node:assert/strict';
import test from 'node:test';
import { SpendMeter } from './rally/spend';

/** A mocked LIVE wallet: no broadcast, each send takes 120 ms and returns fake txids. */
const mock = (budget: number) => {
  let left = budget;
  let seq = 0;
  const batches: number[] = [];
  const io = {
    send: async (_n: number, batch: string[][]) => {
      await new Promise((r) => setTimeout(r, 120));
      const take = Math.min(batch.length, left);
      left -= take;
      batches.push(take);
      return Array.from({ length: take }, () => `tx${++seq}`);
    },
    canPay: (n: number) => n <= left,
    batchMax: () => 40,
    onChange: () => undefined,
  };
  return { io, batches, left: () => left };
};

test('rally spend: 60 fps requests at ~5/s are all sent in small batches without ever blocking', async () => {
  const m = mock(1000);
  const meter = new SpendMeter(m.io);
  const times: number[] = [];
  const t0 = Date.now();
  let requested = 0;
  // 8 seconds of game at 60 fps, one action every 12 frames (5/s).
  for (let f = 0; f < 480; f++) {
    const a = performance.now();
    if (f % 12 === 0) {
      const r = meter.request('fuel', String(f));
      // Never blocks: request() answers synchronously (a boolean, never a promise waiting on the wallet).
      assert.equal(typeof r, 'boolean');
      assert.ok(r);
    }
    if (f === 100) meter.request('nitro', 'burst');
    times.push(performance.now() - a);
    requested = meter.requested;
    await new Promise((r) => setTimeout(r, 1000 / 60));
  }
  await meter.whenIdle();
  assert.equal(meter.sent, requested);
  // Typical cost, not the single worst sample: one GC pause or a busy machine shouldn't fail CI.
  const median = [...times].sort((x, y) => x - y)[times.length >> 1];
  assert.ok(median < 2, `request() must be cheap per frame (median ${median.toFixed(3)} ms)`);
  assert.ok(m.batches.every((b) => b <= 5), `batches stay small at this rate: ${m.batches.join(',')}`);
  assert.ok(Date.now() - t0 < 20_000); // 8 s of frames; generous for loaded CI machines
  assert.equal(meter.byKind.nitro, 1);
  assert.ok(meter.firstTx && meter.lastTx && meter.ticker.length > 0);
});

test('rally spend: runs dry when the wallet cannot cover the queue, then coasts', async () => {
  const m = mock(5);
  const meter = new SpendMeter(m.io);
  const ok = Array.from({ length: 8 }, (_, i) => meter.request('fuel', String(i)));
  assert.deepEqual(ok, [true, true, true, true, true, false, false, false]);
  await meter.whenIdle();
  assert.equal(meter.sent, 5);
});

test('rally spend: a failed batch clears the queue and reports the error', async () => {
  const meter = new SpendMeter({ send: async () => [], canPay: () => true, batchMax: () => 40, onChange: () => undefined });
  meter.request('split', 'CP1');
  await meter.whenIdle();
  assert.equal(meter.sent, 0);
  assert.match(meter.error ?? '', /Out of fuel/);
  assert.equal(meter.queued, 0);
});
