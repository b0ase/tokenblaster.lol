import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allUnspent, bestCredit, spendableSats, type Utxo } from './creditRead';
import { chainSats } from './gunKeys';

const dust = (n: number, v = 6): Utxo[] => Array.from({ length: n }, (_, i) => ({ tx_hash: `d${i}`, tx_pos: 1, value: v }));

test('every page is read: the big coin on page 8 counts (owner gun, 31 Oct 2026)', async () => {
  const pages = Array.from({ length: 10 }, (_, i) => (i === 7 ? [...dust(999), { tx_hash: 'e66b', tx_pos: 0, value: 5_792_065 }] : dust(1000)));
  const { coins, complete } = await allUnspent(async (t) => {
    const i = t ? Number(t) : 0;
    return { result: pages[i], nextPageToken: i + 1 < pages.length ? String(i + 1) : undefined };
  });
  assert.ok(complete);
  assert.equal(coins.length, 10_000);
  assert.equal(spendableSats(coins), 5_792_065 + 9_999 * 6);
  const capped = await allUnspent(async (t) => ({ result: dust(1000), nextPageToken: String(Number(t ?? 0) + 1) }), 3);
  assert.equal(capped.complete, false);
});

test('1-sat token outputs and mempool-spent coins are not credit', () => {
  assert.equal(spendableSats([{ tx_hash: 'a', tx_pos: 0, value: 1 }, { tx_hash: 'b', tx_pos: 0, value: 50, isSpentInMempoolTx: true }, { tx_hash: 'c', tx_pos: 0, value: 7 }]), 7);
});

test('the credit shown is never lower than any read; null only when none answered', () => {
  assert.equal(bestCredit([7_000, 5_852_065]), 5_852_065);
  assert.equal(bestCredit([null, 7_000]), 7_000);
  assert.equal(bestCredit([null, undefined]), null);
});

test('chainSats: a lagging list (top coins only) never hides the full total', async () => {
  const f = async () => new Response(JSON.stringify([{ txid: 'x', vout: 0, sats: 7_000 }]), { headers: { 'x-coins-total': '5852065' } });
  assert.equal(await chainSats('1Dyk4db7rdzEkDos6YE2gbKrQgnoAuzfX1', f), 5_852_065);
  const old = async () => new Response(JSON.stringify([{ txid: 'x', vout: 0, sats: 7_000 }]));
  assert.equal(await chainSats('1Dyk4db7rdzEkDos6YE2gbKrQgnoAuzfX1', old), 7_000);
});

test('a page that fails after the first keeps what was read (incomplete), the first failing throws', async () => {
  const r = await allUnspent(async (t) => {
    if (t === '2') throw new Error('WOC 429');
    return { result: dust(1000), nextPageToken: String(Number(t ?? 0) + 1) };
  });
  assert.deepEqual([r.coins.length, r.complete], [2000, false]);
  await assert.rejects(allUnspent(async () => Promise.reject(new Error('down'))));
});
