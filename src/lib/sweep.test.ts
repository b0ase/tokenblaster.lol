import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2PKH, PrivateKey, Transaction } from '@bsv/sdk';
import { INPUT_COST, buildSweep, sweepable } from './sweep';
import { gunKeysForSweep } from './gunKeys';
import { showUnload, unloadLabel } from './coinop/playButton';

const key = PrivateKey.fromRandom();
const me = key.toAddress();
const to = PrivateKey.fromRandom().toAddress();
/** A fake parent paying `values` to the gun (never broadcast). */
function parent(values: number[]) {
  const t = new Transaction();
  for (const v of values) t.addOutput({ lockingScript: new P2PKH().lock(me), satoshis: v });
  return t;
}

test('sweep: every coin worth more than its fee, largest first; dust and 1-sat tokens stay', async () => {
  const big = parent([5_792_065]);
  const dust = parent([...Array(50).fill(6), 1, 1_734_305]);
  const coins = [{ tx: big, vout: 0 }, ...dust.outputs.map((_, i) => ({ tx: dust, vout: i })), { tx: big, vout: 0 }];
  const use = sweepable(coins);
  assert.equal(use.length, 2, 'the two real coins, once each');
  assert.equal(use[0].tx.outputs[use[0].vout].satoshis, 5_792_065);
  const s = await buildSweep(key, coins, to);
  assert.ok(s);
  assert.equal(s.tx.outputs.length, 1);
  assert.equal(s.tx.outputs[0].lockingScript.toHex(), new P2PKH().lock(to).toHex(), 'paid to the player wallet only');
  const fee = 5_792_065 + 1_734_305 - s.sats;
  assert.ok(fee > 0 && fee <= 2 * INPUT_COST + 50, `fee ${fee}`);
  assert.equal(await buildSweep(key, [{ tx: parent([6, 6]), vout: 0 }], to), null, 'nothing worth moving');
});

test('stored keys for sending back: current first, archived keys only when the key matches its address', () => {
  const cur = PrivateKey.fromRandom();
  const old = PrivateKey.fromRandom();
  const m = new Map<string, string>([
    ['tokenblaster.gun', JSON.stringify({ wif: cur.toWif() })],
    ['tokenblaster.gun.keys', JSON.stringify([{ wif: old.toWif(), address: old.toAddress(), at: 1 }, { wif: old.toWif(), address: me, at: 2 }])],
  ]);
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: () => undefined };
  assert.deepEqual(gunKeysForSweep(st).map((k) => k.address), [cur.toAddress(), old.toAddress()]);
});

test('UNLOAD is always shown when this browser has a gun key, even on a $0 / failed read', () => {
  assert.equal(showUnload(0, 0, true), true);
  assert.equal(showUnload(0, 0, false), false);
  assert.equal(unloadLabel(0), 'UNLOAD → wallet (check balance)');
  assert.match(unloadLabel(0.25), /UNLOAD \$0\.25 → wallet/);
});
