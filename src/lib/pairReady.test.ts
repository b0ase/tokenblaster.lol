import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey } from '@bsv/sdk';
import { startPairing, _forgetPhoneForReload } from './pair/site';
import { getSiteWallet, pickWallet, _resetSiteWallet, resumeSiteWallet } from './siteWallet';
import { getBarWallet } from './walletBar';
import { savePending } from './pair/returnStore';
import { Sealer, deriveSession, newChannel, newRequestId, parsePairUrl, type PairMessage, type SealedFrame } from './pair/protocol';

// Owner, iPhone, 27 Oct 2026: paired bWallet, approved, and the site still said "Connect wallet".
class MockSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static all: MockSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    MockSocket.all.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}
const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
};
const g = globalThis as Record<string, unknown>;
g.WebSocket = MockSocket;
g.sessionStorage = mem();
g.localStorage = mem();
const listeners: Record<string, (() => void)[]> = {};
const win = { postMessage: () => undefined, addEventListener: (t: string, f: () => void) => void (listeners[t] ??= []).push(f), removeEventListener: () => undefined, dispatchEvent: () => true, location: { host: 'www.tokenblaster.lol', search: '' } } as Record<string, unknown>;
win.self = win.top = win;
g.window = win;
g.Event = class { constructor(readonly type: string) {} };
g.location = { origin: 'https://www.tokenblaster.lol', href: 'https://www.tokenblaster.lol/arcade/terrornode', hash: '' };
g.history = { state: null, replaceState: (_s: unknown, _t: string, u: string) => ((g.location as { hash: string; href: string }).hash = '', ((g.location as { href: string }).href = u)) };
g.fetch = async () => ({ ok: false, status: 404, json: async () => null });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const KEY = PrivateKey.fromRandom().toPublicKey().toString();

/** The phone answers the connect (getPublicKey) the site sends after ready. */
async function answerConnect(sock: MockSocket, phone: Sealer) {
  for (let i = 0; i < 400 && getSiteWallet().wallet?.id !== 'phone'; i++) {
    while (sock.sent.length) {
      const m = await phone.open(JSON.parse(sock.sent.shift()!) as SealedFrame);
      if (m?.t === 'req') sock.push(await phone.seal({ t: 'res', id: m.id, result: { publicKey: KEY } } as PairMessage));
    }
    await tick(1);
  }
}

/** The chooser's pairing (WalletChooser: ready -> pickWallet), with a fake bWallet answering the connect. */
async function pairThroughChooser() {
  let link = '';
  const stop = startPairing((s) => {
    if (s.k === 'qr') link = s.link;
    if (s.k === 'ready') void pickWallet({ id: 'phone', name: `${s.phone} on your phone`, icon: null, kind: 'phone', wallet: s.wallet, fresh: true });
  });
  while (!link) await tick();
  const sock = MockSocket.all.at(-1)!;
  const L = parsePairUrl(link);
  const W = PrivateKey.fromRandom();
  sock.push({ t: 'hello', k: W.toPublicKey().toString(), info: { name: 'bWallet', rdns: 'space.bwallet' } });
  const { key } = await deriveSession(W, L.k, L.c);
  const phone = new Sealer(key, 'wallet');
  await tick();
  sock.push(await phone.seal({ t: 'ready' }));
  await answerConnect(sock, phone);
  stop(); // the chooser closes
}

test('ready frame -> the site wallet is the phone, connected everywhere; a reload restores it', async () => {
  _resetSiteWallet();
  await pairThroughChooser();
  let s = getSiteWallet();
  assert.equal(s.wallet?.id, 'phone');
  assert.equal(s.live, true);
  assert.equal(s.chooser, null);
  assert.equal(getBarWallet()?.publicKey, KEY);

  // Pair again (a new QR while a phone is already paired): the new pairing must still survive a reload.
  await pairThroughChooser();
  assert.equal(getSiteWallet().wallet?.id, 'phone');
  assert.ok((g.sessionStorage as Storage).getItem('tokenblaster.pair'), 'the paired session is kept for a reload');

  // Reload: fresh module state, same tab storage. Page load asks the phone nothing: the kept key resumes it.
  await tick(20);
  _forgetPhoneForReload();
  _resetSiteWallet();
  resumeSiteWallet();
  for (let i = 0; i < 400 && !getSiteWallet().wallet; i++) await tick(5);
  s = getSiteWallet();
  assert.equal(s.wallet?.id, 'phone');
  assert.equal(s.wallet?.publicKey, KEY);
  assert.equal(s.live, true);
});

test('same phone: bWallet returns to the SAME tab (hash only, no reload) -> connected', async () => {
  _resetSiteWallet();
  (g.sessionStorage as Storage).clear();
  (g.localStorage as Storage).clear();
  const loc = g.location as { hash: string; href: string };
  loc.hash = '';
  resumeSiteWallet(); // page load, before the player left for bWallet
  assert.equal(getSiteWallet().wallet, null);
  // The pairing the player took to bWallet (saved on pagehide by rememberPairing).
  const S = PrivateKey.fromRandom();
  const c = newChannel();
  const rid = newRequestId();
  savePending({ c, r: 'wss://relay.example', s: S.toHex(), e: Math.floor(Date.now() / 1000) + 300, rid, ret: loc.href, at: Date.now() });
  // bWallet sends the player back: same URL plus #bwx=ok&rid=…, so only a hashchange fires.
  const before = MockSocket.all.length;
  loc.hash = `#bwx=ok&rid=${rid}`;
  for (const f of listeners.hashchange ?? []) f();
  for (let i = 0; i < 200 && MockSocket.all.length === before; i++) await tick();
  const sock = MockSocket.all.at(-1)!;
  await tick(10);
  const W = PrivateKey.fromRandom();
  sock.push({ t: 'hello', k: W.toPublicKey().toString(), info: { name: 'bWallet', rdns: 'space.bwallet' } });
  const { key } = await deriveSession(W, S.toPublicKey().toString(), c);
  const phone = new Sealer(key, 'wallet');
  await tick();
  sock.push(await phone.seal({ t: 'ready' }));
  await answerConnect(sock, phone);
  const s = getSiteWallet();
  assert.equal(s.wallet?.id, 'phone');
  assert.equal(s.live, true);
  assert.equal(s.waiting, null);
  assert.equal(getBarWallet()?.publicKey, KEY);
  assert.equal(loc.hash, '', 'the return hash is cleaned out');
});
