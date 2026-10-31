import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAllowed, midRunReload, playerWords, RELOAD_STILL_HELD } from './midRunPay';

function rig(o: { holdSticks?: boolean; pay?: () => Promise<boolean> } = {}) {
  const log: string[] = [];
  let held = true;
  const d = {
    pause: () => log.push('pause'),
    stopSender: () => log.push('stop'),
    releaseWallet: async () => {
      log.push('release');
      if (!o.holdSticks) held = false;
    },
    walletHeld: () => held,
    freeWaitMs: 50,
    pay: async () => {
      log.push(held ? 'pay-while-HELD' : 'pay');
      return o.pay ? o.pay() : true;
    },
    resume: () => void log.push('resume'),
    fail: (m: string) => void log.push(`fail:${m}`),
  };
  return { d, log };
}

test('reload mid-fight: pause first, release the wallet, THEN pay, then resume', async () => {
  const { d, log } = rig();
  assert.equal(await midRunReload(d), 'paid');
  assert.deepEqual(log, ['pause', 'stop', 'release', 'pay', 'resume']);
});

test('the wallet is never asked while the game still holds it: stays paused, plain words', async () => {
  const { d, log } = rig({ holdSticks: true });
  assert.equal(await midRunReload(d), 'failed');
  assert.ok(!log.some((l) => l.startsWith('pay')));
  assert.ok(!log.includes('resume'));
  assert.equal(log.at(-1), `fail:${RELOAD_STILL_HELD}`);
});

test('a cancelled or failed payment keeps the game paused (no resume)', async () => {
  const { d, log } = rig({ pay: async () => false });
  assert.equal(await midRunReload(d), 'failed');
  assert.ok(!log.includes('resume'));
  const r2 = rig({ pay: async () => Promise.reject(new Error('WALLET_HELD_DURING_PLAY')) });
  assert.equal(await midRunReload(r2.d), 'failed');
  assert.ok(!r2.log.at(-1)!.includes('WALLET_HELD'));
});

test('no raw error codes for players', () => {
  assert.ok(!/_/.test(playerWords('WALLET_HELD_DURING_PLAY') ?? ''));
  assert.equal(playerWords('ERR_SOMETHING_ODD'), null);
  assert.equal(playerWords('Insufficient funds'), 'Insufficient funds');
});

test('regression 31 Oct 11:46: pay() is never called while the wallet is held, even when a hold lingers a moment', async () => {
  // The storm's own hold drops a few ticks after its session ends: wait for it, then pay.
  const log: string[] = [];
  let held = true;
  const r = await midRunReload({
    pause: () => void log.push('pause'),
    stopSender: () => void log.push('stop'),
    releaseWallet: async () => {
      log.push('release');
      setTimeout(() => (held = false), 120);
    },
    walletHeld: () => held,
    pay: async () => (log.push(held ? 'pay-while-HELD' : 'pay'), true),
    resume: () => void log.push('resume'),
    fail: (m) => void log.push(`fail:${m}`),
  });
  assert.equal(r, 'paid');
  assert.ok(!log.includes('pay-while-HELD'));
  // A hold that never lets go: no pay at all.
  let calls = 0;
  const r2 = await midRunReload({
    pause: () => undefined,
    stopSender: () => undefined,
    releaseWallet: async () => undefined,
    walletHeld: () => true,
    freeWaitMs: 100,
    pay: async () => (calls++, true),
    resume: () => undefined,
    fail: () => undefined,
  });
  assert.equal(r2, 'failed');
  assert.equal(calls, 0);
});

test('no load (auto-load / LOCK & LOAD) may start while a reload payment is open or the game is paused for it', () => {
  assert.equal(loadAllowed({ midPay: true, paused: true }), false);
  assert.equal(loadAllowed({ midPay: true, paused: false }), false);
  assert.equal(loadAllowed({ midPay: false, paused: true }), false);
  assert.equal(loadAllowed({ midPay: false, paused: false }), true);
});
