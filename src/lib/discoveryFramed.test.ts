import { test } from 'node:test';
import assert from 'node:assert/strict';

// A framed page (bChatX ?embed=1) where the extension injects window.CWI only after a round trip (bWalletX #407).
type W = EventTarget & { CWI?: unknown; self: unknown; top: unknown; location: { host: string; search: string }; parent?: unknown };
const mkWindow = (): W => {
  const w = new EventTarget() as W;
  w.self = w;
  w.top = {};
  w.location = { host: 'tokenblaster.lol', search: '?embed=1' };
  return w;
};
const fakeWallet = { getVersion: async () => ({ version: 'bwalletx-5.1.0' }) };

test('framed: a window.CWI that appears 700 ms late is waited for, not reported as no wallet', async () => {
  const w = mkWindow();
  Object.assign(globalThis, { window: w, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const { waitForLateWallet } = await import('./discovery');
  setTimeout(() => (w.CWI = fakeWallet), 700);
  const t0 = Date.now();
  await waitForLateWallet(2000, 50);
  const ms = Date.now() - t0;
  assert.ok(w.CWI, 'CWI arrived');
  assert.ok(ms >= 650 && ms < 1200, `resolved at ${ms} ms, right after CWI appeared`);
});

test('framed: a late brc100 announce answers the wait (asked again while waiting)', async () => {
  const w = mkWindow();
  Object.assign(globalThis, { window: w });
  const { waitForLateWallet } = await import('./discovery');
  w.addEventListener('brc100:requestWallet', () => {
    setTimeout(() => w.dispatchEvent(Object.assign(new Event('brc100:announceWallet'), { detail: { info: { uuid: 'u', name: 'bWalletX', rdns: 'com.bwalletx' }, wallet: fakeWallet } })), 300);
  });
  const got = await waitForLateWallet(2000, 50);
  assert.deepEqual(got.map((a) => a.info.rdns), ['com.bwalletx']);
});

test('framed: nothing ever appears, gives up after ~2 s with an empty list', async () => {
  const w = mkWindow();
  Object.assign(globalThis, { window: w });
  const { waitForLateWallet } = await import('./discovery');
  const t0 = Date.now();
  assert.deepEqual(await waitForLateWallet(2000, 50), []);
  assert.ok(Date.now() - t0 >= 1950);
});

test('framed: full discovery offers the late window.CWI', async () => {
  const w = mkWindow();
  Object.assign(globalThis, { window: w });
  Object.assign(w, { postMessage() {}, parent: { postMessage() {} } });
  const { discoverWallets } = await import('./discovery');
  // the frame host (bChatX) is not a wallet: XDM times out (2.5 s), the announce window passes (~1.6 s),
  // and only then does the extension inject window.CWI: inside the new ~2 s framed wait
  setTimeout(() => (w.CWI = fakeWallet), 4500);
  const list = await discoverWallets();
  assert.ok(list.some((x) => x.id === 'window.CWI' && x.name === 'bWalletX'), JSON.stringify(list.map((x) => x.id)));
});
