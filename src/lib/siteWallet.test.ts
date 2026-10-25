import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, type WalletInterface } from '@bsv/sdk';
// The stubs below are read lazily (inside calls), so these imports may come first.
import { connectEntry, disconnectSiteWallet, getSiteWallet, subSiteWallet, walletErrorText, setSiteWalletLive, _resetSiteWallet } from './siteWallet';
import { getBarWallet } from './walletBar';

// Browser bits the store touches (storage, postMessage, the paymail lookup), stubbed: no network, no wallet.
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
};
const g = globalThis as Record<string, unknown>;
g.sessionStorage = mem();
g.localStorage = mem();
const posted: unknown[] = [];
g.window = { postMessage: (m: unknown) => posted.push(m) };
g.location = { origin: 'https://www.tokenblaster.lol' };
g.fetch = async () => ({ ok: false, status: 404, json: async () => null });

type Entry = Parameters<typeof connectEntry>[0];

// A throwaway key made here (unfunded, never broadcast): only its public key is ever asked for.
const KEY = PrivateKey.fromRandom().toPublicKey().toString();
let asks = 0;
const fake = (): WalletInterface =>
  ({
    getPublicKey: async () => (asks++, { publicKey: KEY }),
    isAuthenticated: async () => ({ authenticated: true }),
  }) as unknown as WalletInterface;
const entry = (over: Partial<Entry> = {}): Entry => ({ id: 'com.bwalletx.extension', name: 'bWalletX', icon: null, kind: 'extension', wallet: fake(), ...over });

beforeEach(() => {
  _resetSiteWallet();
  (g.sessionStorage as { clear: () => void }).clear();
  asks = 0;
});

test('connect in one place is seen everywhere: page hooks, the top bar chip', async () => {
  const seenByPage: (string | null)[] = [];
  const off = subSiteWallet(() => seenByPage.push(getSiteWallet().wallet?.publicKey ?? null));
  const w = await connectEntry(entry()); // e.g. the top bar's chooser
  off();
  assert.equal(w?.publicKey, KEY);
  assert.equal(getSiteWallet().wallet?.publicKey, KEY); // useLaunchWallet / useBlaster / the cabinet read this
  assert.ok(seenByPage.includes(KEY));
  assert.equal(getBarWallet()?.publicKey, KEY); // the chip
  assert.equal(getSiteWallet().wallet?.address.length && getSiteWallet().wallet!.address[0], '1');
});

test('a second Connect (another button, a reload) never asks the identity key again', async () => {
  await connectEntry(entry());
  await connectEntry(entry());
  assert.equal(asks, 1);
  _resetSiteWallet(); // a reload: same tab, key kept in sessionStorage
  await connectEntry(entry());
  assert.equal(asks, 1);
});

test('a fresh phone pairing asks for its key (it may be another phone)', async () => {
  await connectEntry(entry({ id: 'phone', kind: 'phone', name: 'bWallet on your phone' }));
  await connectEntry(entry({ id: 'phone', kind: 'phone', name: 'bWallet on your phone', fresh: true }));
  assert.equal(asks, 2);
});

test('a wallet that stopped answering gets a real reconnect', async () => {
  await connectEntry(entry());
  setSiteWalletLive(false);
  assert.equal(getBarWallet()?.live, false);
  await connectEntry(entry());
  assert.equal(asks, 2);
  assert.equal(getSiteWallet().live, true);
});

test('disconnect clears every page and the top bar, and tells bWalletX', async () => {
  await connectEntry(entry());
  posted.length = 0;
  disconnectSiteWallet();
  assert.equal(getSiteWallet().wallet, null);
  assert.equal(getBarWallet(), null);
  assert.deepEqual(posted, [{ type: 'bwallet:disconnect' }]);
  await connectEntry(entry()); // and the next connect asks again
  assert.equal(asks, 2);
});

test('a refused connect is plain words, never the raw "Permission denied."', async () => {
  const w = await connectEntry(entry({ id: 'phone', kind: 'phone', name: 'bWallet on your phone', wallet: { getPublicKey: async () => Promise.reject(new Error('Permission denied.')) } as unknown as WalletInterface }));
  assert.equal(w, null);
  const err = getSiteWallet().error ?? '';
  assert.doesNotMatch(err, /permission denied/i);
  assert.match(err, /scan a new code/);
  assert.match(walletErrorText(new Error('WALLET_TIMEOUT'), { kind: 'phone', name: 'x' }), /asleep/);
});

test('play hold: Connect during a live round asks nothing and leaves no "disconnected" / "round is still live" behind', async () => {
  const { holdWalletForPlay } = await import('./wallet');
  const { setSiteWalletError, HELD_TEXT } = await import('./siteWallet');
  await connectEntry(entry());
  const before = asks;
  holdWalletForPlay(true, 'play');
  try {
    await connectEntry(entry(), { retry: true });
    assert.equal(asks, before); // the wallet was not asked
    assert.equal(getSiteWallet().error, null);
    // A note left by an earlier refusal (the owner's page) is dropped the moment no round holds the wallet.
    setSiteWalletError(walletErrorText(new Error('WALLET_HELD_DURING_PLAY')));
    assert.match(getSiteWallet().error ?? '', HELD_TEXT);
  } finally {
    holdWalletForPlay(false, 'play');
  }
  assert.equal(getSiteWallet().error, null);
  assert.ok(getSiteWallet().wallet);
});
