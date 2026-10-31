import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGunBusy, withGunBusyRetry } from './settleRetry';

const BUSY = 'Another TokenBlaster tab is using the gun. Close it and try again.';
const noSleep = async () => undefined;

test('31 Oct 11:47: a settlement that meets a busy gun waits and pays, it does not fail', async () => {
  let n = 0;
  const waits: number[] = [];
  const r = await withGunBusyRetry(
    async () => {
      if (++n < 3) throw new Error(BUSY);
      return 'txid';
    },
    { sleep: noSleep, onWait: (ms) => waits.push(ms) },
  );
  assert.equal(r, 'txid');
  assert.equal(n, 3);
  assert.deepEqual(waits, [2000, 4000]); // backoff grows
});

test('other errors are thrown at once (no retry)', async () => {
  let n = 0;
  await assert.rejects(
    withGunBusyRetry(async () => (n++, Promise.reject(new Error('ARC rejected'))), { sleep: noSleep }),
    /ARC rejected/,
  );
  assert.equal(n, 1);
});

test('busy past every retry: the busy error comes back so the caller keeps it pending', async () => {
  let n = 0;
  await assert.rejects(withGunBusyRetry(async () => (n++, Promise.reject(new Error(BUSY))), { sleep: noSleep, delays: [1, 1] }), (e) => isGunBusy(e));
  assert.equal(n, 3);
});
