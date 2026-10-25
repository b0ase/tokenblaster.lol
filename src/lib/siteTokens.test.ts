import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LockingScript, UnlockingScript, P2PKH, PrivateKey, ProtoWallet, PublicKey, Transaction, type WalletInterface } from '@bsv/sdk';
import { ONESAT, RECEIVE, receiveKey, receiveNote, rememberReceive, siteCoins } from './siteTokens';
import { loadTokens } from './tokenLoad';
import { bsv21 } from './gun';
import { resetBasketSession } from './basketSession';
import { matchesPlan } from './launch/shape';

const ID = 'ab'.repeat(32) + '_0';
const GUN = new PrivateKey(7).toAddress();

type Call = { method: string; args: Record<string, unknown> };

/** A mock BRC-100 wallet over a real ProtoWallet. `bwalletx`: answers keyIDs, refuses onesat + bsv21 reads, signs token inputs itself. */
function mockWallet(mode: 'bwalletx' | 'other' | 'onesat-only', coins: { outpoint: string; tx: Transaction; vout: number; keyID: string; amt: bigint }[] = []) {
  const proto = new ProtoWallet(new PrivateKey(42));
  const calls: Call[] = [];
  let created: { inputs: { outpoint: string }[]; outputs: { lockingScript: string; satoshis: number }[] } | null = null;
  let n = 0;
  const w = {
    calls,
    async getPublicKey(a: { protocolID: [0 | 1 | 2, string]; keyID: string; counterparty?: string }) {
      calls.push({ method: 'getPublicKey', args: a });
      const p = a.protocolID[1];
      if (p === 'onesat' && mode === 'bwalletx') throw new Error('This protocol is reserved for bWalletX itself: "onesat"');
      if (p === 'bwalletx token receive' && mode === 'onesat-only') throw new Error('Unknown protocol');
      if (p === 'bwalletx token receive' && mode === 'bwalletx') {
        const keyID = `${a.keyID}-${1000 + n++}`;
        return { ...(await proto.getPublicKey({ ...a, keyID })), keyID };
      }
      return proto.getPublicKey(a);
    },
    async createSignature(a: Parameters<ProtoWallet['createSignature']>[0]) {
      calls.push({ method: 'createSignature', args: a as never });
      if (mode === 'bwalletx') throw new Error('refused');
      return proto.createSignature(a);
    },
    async listOutputs(a: { basket: string }) {
      calls.push({ method: 'listOutputs', args: a });
      if (mode === 'bwalletx') throw Object.assign(new Error('This basket is reserved for bWalletX itself: "bsv21"'), { code: 'ERR_RESERVED' });
      if (a.basket !== 'bsv21') return { totalOutputs: 0, outputs: [] };
      return {
        totalOutputs: coins.length,
        BEEF: coins.length ? coins[0].tx.toBEEF() : undefined,
        outputs: coins.map((c) => ({
          outpoint: c.outpoint,
          satoshis: 1,
          spendable: true,
          tags: [`bsv21:${ID}`, 'id:x_0'],
          customInstructions: JSON.stringify({ id: ID, amt: c.amt.toString(), protocolID: RECEIVE, keyID: c.keyID }),
        })),
      };
    },
    async createAction(a: { inputs?: { outpoint: string }[]; outputs: { lockingScript: string; satoshis: number }[] }) {
      calls.push({ method: 'createAction', args: a as never });
      created = { inputs: a.inputs ?? [], outputs: a.outputs };
      const tx = new Transaction();
      for (const i of a.inputs ?? []) {
        const [txid, vout] = i.outpoint.split('.');
        const src = coins.find((c) => c.outpoint === i.outpoint)?.tx ?? fakeSource(txid);
        tx.addInput({ sourceTransaction: src, sourceTXID: src.id('hex'), sourceOutputIndex: Number(vout), sequence: 0xffffffff, unlockingScript: new UnlockingScript() });
      }
      for (const o of a.outputs) tx.addOutput({ lockingScript: LockingScript.fromHex(o.lockingScript), satoshis: o.satoshis });
      return { signableTransaction: { reference: 'ref1', tx: tx.toAtomicBEEF() } };
    },
    async signAction(a: { reference: string; spends: Record<number, unknown> }) {
      calls.push({ method: 'signAction', args: a });
      return { txid: 'f'.repeat(64) };
    },
    async abortAction() {
      return { aborted: true };
    },
    get created() {
      return created;
    },
  };
  return w;
}

const fakeSource = (seed: string) => new Transaction(1, [], [{ lockingScript: new P2PKH().lock(new PrivateKey(Number.parseInt(seed.slice(0, 6), 16) || 3).toAddress()), satoshis: 1 }], 0);

const fetchStub = (rows: Record<string, unknown[]>) => {
  globalThis.fetch = (async (url: string) => {
    const hit = Object.entries(rows).find(([k]) => String(url).includes(k));
    return { ok: !!hit, json: async () => hit?.[1] ?? [] } as Response;
  }) as typeof fetch;
};

beforeEach(() => resetBasketSession());

test('bWalletX: receive key comes back with the wallet-chosen keyID; note is { keyID } only', async () => {
  const w = mockWallet('bwalletx');
  const k = await receiveKey(w as unknown as WalletInterface, ID);
  assert.equal(k.walletSigns, true);
  assert.deepEqual(k.protocolID, RECEIVE);
  assert.match(k.keyID, new RegExp(`^${ID}-\\d+$`));
  assert.deepEqual(JSON.parse(receiveNote(k, () => 'unused')), { keyID: k.keyID });
  assert.deepEqual(w.calls[0].args, { protocolID: RECEIVE, keyID: ID, counterparty: 'self' });
});

test('other BRC-100 wallet: no keyID returned → record the full note under the receive protocol', async () => {
  const w = mockWallet('other');
  const k = await receiveKey(w as unknown as WalletInterface, ID);
  assert.equal(k.walletSigns, false);
  assert.equal(k.keyID, ID);
  assert.deepEqual(k.protocolID, RECEIVE);
  assert.equal(receiveNote(k, () => 'full'), 'full');
});

test('wallet refusing the receive protocol falls back to the 1Sat key', async () => {
  const w = mockWallet('onesat-only');
  const k = await receiveKey(w as unknown as WalletInterface, ID);
  assert.deepEqual(k.protocolID, ONESAT);
  assert.equal(k.walletSigns, false);
});

test('bWalletX: load spends coins on our receive keys, 108-byte inputs, no createSignature, no spends for them', async () => {
  const w = mockWallet('bwalletx');
  const k = await receiveKey(w as unknown as WalletInterface, ID);
  const coinTxid = 'cd'.repeat(32);
  fetchStub({ [`/bsv20/${k.address}/id/${ID}`]: [{ outpoint: `${coinTxid}_1`, amt: '500', status: 1 }] });
  rememberReceive(ID, k.address);
  assert.equal((await siteCoins(ID)).length, 1);
  await loadTokens(w as unknown as WalletInterface, ID, BigInt(200), GUN, 'AMMO').catch((e) => {
    // our mock signAction returns no tx: the wallet-signed path must refuse to fake one
    assert.match(String(e), /returned no transaction/);
  });
  const ca = w.calls.find((c) => c.method === 'createAction')!.args as { inputs: { outpoint: string; unlockingScriptLength: number }[]; outputs: { lockingScript: string; satoshis: number; basket?: string; customInstructions?: string }[]; options: Record<string, unknown> };
  assert.deepEqual(ca.inputs, [{ outpoint: `${coinTxid}.1`, unlockingScriptLength: 108, inputDescription: '$AMMO' }]);
  assert.equal(ca.options.signAndProcess, false);
  assert.equal(ca.options.randomizeOutputs, false);
  const change = ca.outputs.find((o) => o.basket === 'bsv21')!;
  const ci = JSON.parse(change.customInstructions!);
  assert.deepEqual(Object.keys(ci), ['keyID']);
  assert.equal(change.satoshis, 1);
  // change goes to a fresh receive key, exact bsv21 transfer script
  assert.ok(change.lockingScript.endsWith(new P2PKH().lock(PublicKey.fromString((await new ProtoWallet(new PrivateKey(42)).getPublicKey({ protocolID: RECEIVE, keyID: ci.keyID, counterparty: 'self' })).publicKey).toAddress()).toHex()));
  assert.equal(w.calls.filter((c) => c.method === 'createSignature').length, 0);
  const sa = w.calls.find((c) => c.method === 'signAction')!.args as { spends: Record<number, unknown> };
  assert.deepEqual(sa.spends, {});
  assert.equal(w.calls.filter((c) => c.method === 'getPublicKey' && (c.args.protocolID as string[])[1] === 'onesat').length, 0);
});

test('fallback wallet: load signs its own basket coins with createSignature under the recorded key', async () => {
  const proto = new ProtoWallet(new PrivateKey(42));
  const { publicKey } = await proto.getPublicKey({ protocolID: RECEIVE, keyID: ID, counterparty: 'self' });
  const src = new Transaction(1, [], [{ lockingScript: bsv21(ID, BigInt(500), PublicKey.fromString(publicKey).toAddress()), satoshis: 1 }], 0);
  const op = `${src.id('hex')}.0`;
  const w = mockWallet('other', [{ outpoint: op, tx: src, vout: 0, keyID: ID, amt: BigInt(500) }]);
  fetchStub({});
  await loadTokens(w as unknown as WalletInterface, ID, BigInt(200), GUN, 'AMMO');
  const sigs = w.calls.filter((c) => c.method === 'createSignature');
  assert.equal(sigs.length, 1);
  assert.deepEqual(sigs[0].args.protocolID, RECEIVE);
  assert.equal(sigs[0].args.keyID, ID);
  const sa = w.calls.find((c) => c.method === 'signAction')!.args as { spends: Record<number, { unlockingScript: string }> };
  assert.ok(sa.spends[0].unlockingScript.length > 100);
  const ca = w.calls.find((c) => c.method === 'createAction')!.args as { outputs: { basket?: string; customInstructions?: string }[] };
  const note = JSON.parse(ca.outputs.find((o) => o.basket === 'bsv21')!.customInstructions!);
  assert.deepEqual(note.protocolID, RECEIVE);
  assert.equal(note.amt, '300');
});

test('trade plan check: pool inputs first, wallet token inputs and token change after, still matches', () => {
  const pool = new Transaction(1, [], [{ lockingScript: new P2PKH().lock(GUN), satoshis: 1 }], 0);
  const coin = new Transaction(1, [], [{ lockingScript: bsv21(ID, BigInt(5), GUN), satoshis: 1 }], 0);
  const tx = new Transaction();
  tx.addInput({ sourceTransaction: pool, sourceOutputIndex: 0, sequence: 0xffffffff });
  tx.addInput({ sourceTransaction: coin, sourceOutputIndex: 0, sequence: 0xffffffff });
  const out = bsv21(ID, BigInt(5), GUN);
  tx.addOutput({ lockingScript: out, satoshis: 1 });
  tx.addOutput({ lockingScript: bsv21(ID, BigInt(2), new PrivateKey(9).toAddress()), satoshis: 1 });
  const plan = { inputs: [{ outpoint: `${pool.id('hex')}_0`, sats: 1, what: 'pool' }], outputs: [{ script: out.toHex(), sats: 1, what: 'tokens' }] };
  assert.deepEqual(matchesPlan(tx, plan), { ok: true });
});
