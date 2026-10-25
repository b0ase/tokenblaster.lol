import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LockingScript, UnlockingScript, P2PKH, PrivateKey, ProtoWallet, PublicKey, Transaction, type WalletInterface } from '@bsv/sdk';
import { ONESAT, ORDINAL_RECEIVE, RECEIVE, receiveKey, receiveNote, rememberReceive, siteCoins } from './siteTokens';
import { loadTokens } from './tokenLoad';
import { bsv21 } from './gun';
import { resetBasketSession } from './basketSession';
import { bsv20Json, checkTokens, matchesPlan } from './launch/shape';
import { inscriptionScript } from './inscribe';
import { deployToWallet } from './walletDeploy';
import { launchImageOutput } from './launch/launchImage';

const ID = 'ab'.repeat(32) + '_0';
const GUN = new PrivateKey(7).toAddress();

type Call = { method: string; args: Record<string, unknown> };

/** A mock BRC-100 wallet over a real ProtoWallet. `bwalletx`: answers keyIDs, refuses onesat + bsv21 reads, signs token inputs itself. */
function mockWallet(mode: 'bwalletx' | 'other' | 'onesat-only', coins: { outpoint: string; tx: Transaction; vout: number; keyID: string; amt: bigint }[] = [], listed?: { outpoint: string; amount: string }[] | 'no') {
  const proto = new ProtoWallet(new PrivateKey(42));
  const calls: Call[] = [];
  let created: { inputs: { outpoint: string }[]; outputs: { lockingScript: string; satoshis: number }[] } | null = null;
  let n = 0;
  let lastTx: number[] = [];
  const w = {
    calls,
    async getPublicKey(a: { protocolID: [0 | 1 | 2, string]; keyID: string; counterparty?: string }) {
      calls.push({ method: 'getPublicKey', args: a });
      const p = a.protocolID[1];
      if (p === 'onesat' && mode === 'bwalletx') throw new Error('This protocol is reserved for bWalletX itself: "onesat"');
      if (p === 'bwalletx token receive' && mode === 'onesat-only') throw new Error('Unknown protocol');
      if ((p === 'bwalletx token receive' || p === 'bwalletx ordinal receive') && mode === 'bwalletx') {
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
    async listOutputs(a: { basket: string; tags?: string[] }) {
      calls.push({ method: 'listOutputs', args: a });
      if (mode === 'bwalletx' && a.tags?.length === 1 && a.tags[0] === `bsv21:${ID}` && listed) {
        if (listed === 'no') throw new Error('You said no: this site cannot see that balance');
        return { totalOutputs: listed.length, outputs: listed.map((o) => ({ ...o, satoshis: 1, spendable: true })) };
      }
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
    async createAction(a: { inputs?: { outpoint: string }[]; outputs: { lockingScript: string; satoshis: number }[]; options?: { signAndProcess?: boolean } }) {
      calls.push({ method: 'createAction', args: a as never });
      created = { inputs: a.inputs ?? [], outputs: a.outputs };
      const tx = new Transaction();
      for (const i of a.inputs ?? []) {
        const [txid, vout] = i.outpoint.split('.');
        const src = coins.find((c) => c.outpoint === i.outpoint)?.tx ?? fakeSource(txid);
        tx.addInput({ sourceTransaction: src, sourceTXID: src.id('hex'), sourceOutputIndex: Number(vout), sequence: 0xffffffff, unlockingScript: new UnlockingScript() });
      }
      for (const o of a.outputs) tx.addOutput({ lockingScript: LockingScript.fromHex(o.lockingScript), satoshis: o.satoshis });
      lastTx = tx.toAtomicBEEF();
      if (a.options?.signAndProcess === false) return { signableTransaction: { reference: 'ref1', tx: lastTx } };
      return { txid: tx.id('hex'), tx: lastTx };
    },
    async signAction(a: { reference: string; spends: Record<number, unknown> }) {
      calls.push({ method: 'signAction', args: a });
      return { txid: Transaction.fromAtomicBEEF(lastTx).id('hex'), tx: lastTx }; // #128: signed AtomicBEEF, sources included
    },
    async internalizeAction(a: Record<string, unknown>) {
      calls.push({ method: 'internalizeAction', args: a });
      return { accepted: true };
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
  await loadTokens(w as unknown as WalletInterface, ID, BigInt(200), GUN, 'AMMO');
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

test('bWalletX #128: sell coins come from its one-token listing (exactly one tag), wallet signs them', async () => {
  const op = `${'ef'.repeat(32)}.2`;
  const w = mockWallet('bwalletx', [], [{ outpoint: op, amount: '900' }]);
  fetchStub({}); // the index must not be needed
  await loadTokens(w as unknown as WalletInterface, ID, BigInt(900), GUN, 'AMMO');
  const lo = w.calls.find((c) => c.method === 'listOutputs' && c.args.tags)!.args as { basket: string; tags: string[]; limit: number };
  assert.deepEqual(lo.tags, [`bsv21:${ID}`]);
  assert.ok(lo.limit <= 1000);
  const ca = w.calls.find((c) => c.method === 'createAction')!.args as { inputs: { outpoint: string; unlockingScriptLength: number }[] };
  assert.deepEqual(ca.inputs.map((i) => [i.outpoint, i.unlockingScriptLength]), [[op, 108]]);
  assert.equal(w.calls.filter((c) => c.method === 'createSignature').length, 0);
});

test('bWalletX #128: "You said no" on the listing reaches the player', async () => {
  const w = mockWallet('bwalletx', [], 'no');
  await assert.rejects(loadTokens(w as unknown as WalletInterface, ID, BigInt(1), GUN, 'AMMO'), /You said no/);
});

test('server sell check reads seller coins from the AtomicBEEF sources the wallet returns', () => {
  const pool = new Transaction(1, [], [{ lockingScript: new P2PKH().lock(GUN), satoshis: 1 }], 0);
  const coin = new Transaction(1, [], [{ lockingScript: bsv21(ID, BigInt(5), GUN), satoshis: 1 }], 0);
  const tx = new Transaction();
  tx.addInput({ sourceTransaction: pool, sourceOutputIndex: 0, sequence: 0xffffffff, unlockingScript: new UnlockingScript() });
  tx.addInput({ sourceTransaction: coin, sourceOutputIndex: 0, sequence: 0xffffffff, unlockingScript: new UnlockingScript() });
  const out = bsv21(ID, BigInt(3), GUN);
  tx.addOutput({ lockingScript: out, satoshis: 1 });
  tx.addOutput({ lockingScript: bsv21(ID, BigInt(2), new PrivateKey(9).toAddress()), satoshis: 1 }); // change to a fresh receive key
  const back = Transaction.fromAtomicBEEF(tx.toAtomicBEEF()); // as the server parses it
  const plan = {
    side: 'sell' as const,
    tokenId: ID,
    inputs: [{ outpoint: `${pool.id('hex')}_0`, sats: 1, what: 'pool' }],
    outputs: [{ script: out.toHex(), sats: 1, what: 'tokens' }],
    sellerCoins: [`${coin.id('hex')}_0`],
    allowedTokenOut: '2',
  };
  assert.equal(checkTokens(back, plan), null);
  assert.match(String(checkTokens(back, { ...plan, allowedTokenOut: '1' })), /more of this coin/);
  assert.match(String(checkTokens(back, { ...plan, sellerCoins: [] })), /not quoted/);
});

test('bWalletX #128: ammo deploy is a plain output, then internalized into bsv21 with { keyID }; JSON only p/op/sym/amt/dec/icon', async () => {
  const w = mockWallet('bwalletx');
  const def = { sym: 'AMMO', supply: BigInt(1_000_000_000), dec: 0 };
  const id = await deployToWallet(w as unknown as WalletInterface, { ...(def as object as { sym: string; supply: bigint; dec: number }), icon: '_1', description: 'd', labels: [] }, async () => GUN);
  const ca = w.calls.find((c) => c.method === 'createAction')!.args as { outputs: { lockingScript: string; basket?: string; customInstructions?: string }[] };
  assert.equal(ca.outputs[0].basket, undefined);
  assert.equal(ca.outputs[0].customInstructions, undefined);
  const j = bsv20Json(ca.outputs[0].lockingScript)!;
  assert.deepEqual(Object.keys(j).sort(), ['amt', 'dec', 'icon', 'op', 'p', 'sym'].filter((k) => k in j).sort());
  for (const k of Object.keys(j)) assert.ok(['p', 'op', 'sym', 'amt', 'dec', 'icon'].includes(k), k);
  assert.equal(j.op, 'deploy+mint');
  const kc = w.calls.find((c) => c.method === 'getPublicKey')!.args;
  assert.deepEqual([kc.protocolID, kc.keyID], [RECEIVE, 'deploy']);
  const ia = w.calls.find((c) => c.method === 'internalizeAction')!.args as { outputs: { outputIndex: number; protocol: string; insertionRemittance: { basket: string; customInstructions: string } }[] };
  assert.equal(ia.outputs[0].protocol, 'basket insertion');
  assert.equal(ia.outputs[0].insertionRemittance.basket, 'bsv21');
  assert.match(JSON.parse(ia.outputs[0].insertionRemittance.customInstructions).keyID, /^deploy-\d+$/);
  assert.match(id, /^[0-9a-f]{64}_0$/);
});

test('fallback wallet: ammo deploy keeps the 1Sat note path, no internalize', async () => {
  const w = mockWallet('other');
  await deployToWallet(w as unknown as WalletInterface, { sym: 'AMMO', supply: BigInt(10), dec: 0, description: 'd', labels: [] }, async (keyID) => (await new ProtoWallet(new PrivateKey(42)).getPublicKey({ protocolID: ONESAT, keyID, counterparty: 'self' }), GUN));
  const ca = w.calls.find((c) => c.method === 'createAction')!.args as { outputs: { basket?: string }[] };
  assert.equal(ca.outputs[0].basket, 'bsv21');
  assert.equal(w.calls.filter((c) => c.method === 'internalizeAction').length, 0);
});

test('BlastPad launch image: bWalletX gets a plain inscription on its ordinal key in 1sat; others keep the MAP to the creator', async () => {
  const img = { bytes: new Uint8Array([1, 2, 3]), type: 'image/png' };
  const bw = mockWallet('bwalletx');
  const o: { lockingScript: string; basket?: string; customInstructions?: string } = await launchImageOutput({ client: bw as unknown as WalletInterface, address: GUN }, { sym: 'X', image: img });
  assert.equal(o.basket, '1sat');
  assert.match(JSON.parse(o.customInstructions!).keyID, /^ordinal-\d+$/);
  const kc = bw.calls[0].args;
  assert.deepEqual([kc.protocolID, kc.keyID], [ORDINAL_RECEIVE, 'ordinal']);
  const addr = PublicKey.fromString((await new ProtoWallet(new PrivateKey(42)).getPublicKey({ protocolID: ORDINAL_RECEIVE, keyID: JSON.parse(o.customInstructions!).keyID, counterparty: 'self' })).publicKey).toAddress();
  assert.equal(o.lockingScript, inscriptionScript(addr, { contentType: 'image/png', data: [1, 2, 3] }).toHex()); // byte for byte, nothing after P2PKH
  assert.ok(o.lockingScript.endsWith(new P2PKH().lock(addr).toHex()));
  const other: { lockingScript: string; basket?: string } = await launchImageOutput({ client: mockWallet('other') as unknown as WalletInterface, address: GUN }, { sym: 'X', image: img });
  assert.equal(other.basket, undefined);
  assert.ok(other.lockingScript.includes(new P2PKH().lock(GUN).toHex()));
  // unsupported type → old path even in bWalletX
  const tiff: { lockingScript: string; basket?: string } = await launchImageOutput({ client: bw as unknown as WalletInterface, address: GUN }, { sym: 'X', image: { bytes: img.bytes, type: 'image/tiff' } });
  assert.equal(tiff.basket, undefined);
});
