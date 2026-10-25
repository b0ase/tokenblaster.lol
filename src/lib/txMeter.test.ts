import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TxMeter } from './txMeter';

test('tx/s counts only what was accepted, over a 2 s window, and falls to 0 when nothing lands', () => {
  const m = new TxMeter(2000);
  assert.equal(m.rate(0), 0);
  // 3,000 accepted a second, in 4 batches a second
  for (let t = 0; t < 4000; t += 250) m.add(750, t);
  assert.equal(m.rate(4000), 3000);
  m.add(0, 4100); // a rejected / empty batch adds nothing
  assert.equal(m.rate(5000), 1500); // half the window is quiet
  assert.equal(m.rate(6001), 0);
});
