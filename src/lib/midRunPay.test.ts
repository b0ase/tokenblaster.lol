import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midRunReload, playerWords, RELOAD_STILL_HELD } from './midRunPay';

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
