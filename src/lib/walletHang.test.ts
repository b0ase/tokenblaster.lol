import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, type WalletInterface } from '@bsv/sdk';
import { cancelSiteWalletWait, connectEntry, getSiteWallet, _resetSiteWallet } from './siteWallet';
import { cancelWalletCalls, connect, fund, serialised, walletBusy, WALLET_CANCELLED } from './wallet';

// Hang / timeout / cancel paths (owner, 25 Oct 2026: Connect and LOCK & LOAD did nothing after a payment sheet
// was left open). A fake BRC-100 wallet whose calls can hang forever; no keys with funds, nothing broadcast.
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
};
const g = globalThis as Record<string, unknown>;
g.sessionStorage ??= mem();
g.localStorage ??= mem();
g.window ??= { postMessage: () => undefined };
g.location ??= { origin: 'https://www.tokenblaster.lol' };
g.fetch = async () => ({ ok: false, status: 404, json: async () => null });

const KEY = PrivateKey.fromRandom().toPublicKey().toString();
const never = () => new Promise<never>(() => undefined);
type Mode = 'hang' | 'ok' | 'reject';
const shim = (mode: { pk: Mode; pay?: Mode }) => {
  let pkCalls = 0;
  const w = {
    getPublicKey: async () => {
      pkCalls++;
      if (mode.pk === 'hang') return never();
      if (mode.pk === 'reject') throw new Error('Permission denied.');
      return { publicKey: KEY };
    },
    createAction: async () => (mode.pay === 'hang' ? never() : { tx: undefined }),
    isAuthenticated: async () => ({ authenticated: true }),
  } as unknown as WalletInterface;
  return { w, mode, calls: () => pkCalls };
};
const entry = (wallet: WalletInterface) => ({ id: 'com.bwalletx.extension', name: 'bWalletX', icon: null, kind: 'extension' as const, wallet });

beforeEach(() => {
  _resetSiteWallet();
  (g.sessionStorage as { clear: () => void }).clear();
});

test('a hung call blocks the queue until it is cancelled; then the next call goes straight through', async () => {
  const s = shim({ pk: 'hang' });
  const c = serialised(s.w);
  const first = c.getPublicKey({ identityKey: true });
  await new Promise((r) => setTimeout(r, 5)); // the wallet has the first request (and never answers it)
  s.mode.pk = 'ok';
  let second: unknown = null;
  const p2 = c.getPublicKey({ identityKey: true }).then((r) => (second = r));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(second, null, 'before: the second call is stuck behind the hung one');
  assert.equal(walletBusy(c), true);
  cancelWalletCalls(s.w);
  await assert.rejects(first, new RegExp(WALLET_CANCELLED));
  await assert.rejects(p2, new RegExp(WALLET_CANCELLED));
  assert.equal(walletBusy(c), false);
  assert.deepEqual(await c.getPublicKey({ identityKey: true }), { publicKey: KEY }, 'after: the queue is free');
});

test('connect times out instead of hanging forever, and frees the queue', async () => {
  const s = shim({ pk: 'hang' });
  await assert.rejects(connect(entry(s.w), 40), /WALLET_TIMEOUT/);
  s.mode.pk = 'ok';
  const w = await connect(entry(s.w), 1000);
  assert.equal(w.publicKey, KEY);
});

test('a payment sheet left open times out, frees the queue, and a new payment can be asked', async () => {
  const s = shim({ pk: 'ok', pay: 'hang' });
  const w = await connect(entry(s.w));
  const addr = PrivateKey.fromRandom().toPublicKey().toAddress();
  await assert.rejects(fund(w, addr, 1000, 't', 40), /WALLET_TIMEOUT/);
  // before the fix: "A payment is already waiting" forever, and every later call queued behind it
  await assert.rejects(fund(w, addr, 1000, 't', 40), /WALLET_TIMEOUT/);
  assert.equal(walletBusy(w.client), false);
});

test('site connect: visible waiting state while the wallet is asked; Cancel clears it and the next click asks again', async () => {
  const s = shim({ pk: 'hang' });
  const p = connectEntry(entry(s.w));
  assert.equal(getSiteWallet().busy, true);
  assert.match(getSiteWallet().waiting?.text ?? '', /Waiting for bWalletX/);
  await new Promise((r) => setTimeout(r, 5));
  cancelSiteWalletWait();
  assert.equal(await p, null);
  assert.equal(getSiteWallet().waiting, null);
  assert.equal(getSiteWallet().busy, false);
  assert.equal(getSiteWallet().error, null, 'a cancel is not an error');
  s.mode.pk = 'ok';
  const w = await connectEntry(entry(s.w), { retry: true });
  assert.equal(w?.publicKey, KEY);
  assert.equal(s.calls(), 2, 'the retry really asked the wallet again');
});

test('site connect: a second pick replaces a hung connect instead of returning the same hung promise', async () => {
  const s = shim({ pk: 'hang' });
  const p1 = connectEntry(entry(s.w));
  s.mode.pk = 'ok';
  const p2 = connectEntry(entry(s.w), { retry: true });
  assert.notEqual(p1, p2);
  assert.equal((await p2)?.publicKey, KEY);
  assert.equal(await p1, null);
  assert.equal(getSiteWallet().wallet?.publicKey, KEY);
  assert.equal(getSiteWallet().waiting, null);
});

test('site connect: a refusal shows plain words and clears the waiting state', async () => {
  const s = shim({ pk: 'reject' });
  assert.equal(await connectEntry(entry(s.w)), null);
  assert.equal(getSiteWallet().waiting, null);
  assert.match(getSiteWallet().error ?? '', /did not approve/);
});
