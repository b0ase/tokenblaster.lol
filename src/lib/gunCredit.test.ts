/**
 * Replays the owner's TERRORNODE state (25 Oct 2026, after #90): $1.00 reached the gun's address, but the wallet only
 * returned a txid, so the gun never saved its own coin. CREDIT read $1.00 from the chain; LOCK & LOAD built no rounds.
 * No network, no wallet: the chain lookup and ARC are stubbed, and every key here is a throwaway.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2PKH, Transaction } from '@bsv/sdk';
import { Gun } from './gun';

const CREDIT_SATS = 2_000_000; // about $1.00

/** A gun with no coin of its own and one paid coin sitting at its address (seen only by the chain lookup). */
function ownerGun() {
  const g = new Gun();
  const paid = new Transaction();
  paid.addOutput({ lockingScript: new P2PKH().lock(g.address), satoshis: CREDIT_SATS });
  const sent: Transaction[] = [];
  const priv = g as unknown as {
    coinsOnChain: () => Promise<{ tx: Transaction; vout: number }[]>;
    broadcastChain: (txs: Transaction[]) => Promise<{ accepted: number }>;
    send: (tx: Transaction) => Promise<void>;
  };
  priv.coinsOnChain = async () => [{ tx: paid, vout: 0 }];
  priv.broadcastChain = async (txs) => (sent.push(...txs), { accepted: txs.length });
  priv.send = async (tx) => void sent.push(tx);
  return { g, paid, sent };
}

test('the replayed state: CREDIT sees the coin, the gun itself holds nothing', async () => {
  const { g } = ownerGun();
  assert.equal(g.sats, 0); // what fireBatch / prepareStorm used to start from
  assert.equal(await g.balance(), CREDIT_SATS); // what the CREDIT shows ($1.00)
});

test('LOCK & LOAD gathers the credit into the gun first (no wallet), so rounds can be built from it', async () => {
  const { g, paid } = ownerGun();
  assert.equal(await g.gather(), CREDIT_SATS);
  assert.equal(g.sats, CREDIT_SATS);
  // The house fee step that used to throw "The gun is empty. Load it first." now spends the gathered coin.
  const txids = await g.fireBatch('sats', 0, [['gallery', 'fee']], { address: g.address, sats: 1000 });
  assert.equal(txids.length, 1);
  assert.ok(g.sats > 0 && g.sats < CREDIT_SATS);
  assert.notEqual(txids[0], paid.id('hex'));
});

test('fireBatch with no saved coin adopts the credit at the address instead of failing', async () => {
  const { g, sent } = ownerGun();
  const txids = await g.fireBatch('sats', 0, [['gallery', 'fee']], { address: g.address, sats: 1000 });
  assert.equal(txids.length, 1);
  assert.equal(sent.length, 1);
});

test('prepareStorm builds the lanes from that credit with no new payment', async () => {
  const { g, sent } = ownerGun();
  await g.prepareStorm(1000, 120);
  assert.equal(sent.length, 1); // the split, signed by the gun's own key
  const split = sent[0];
  assert.ok(split.outputs.length > 1);
  assert.ok(split.outputs.every((o) => o.lockingScript.toHex() === new P2PKH().lock(g.address).toHex()));
});
