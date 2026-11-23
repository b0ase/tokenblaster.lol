/**
 * Phone pairing on @bwalletx/connect (src/lib/pair/site.ts): the relay claims the relay requires from 30 Nov 2026, the
 * chooser's states, bWallet's reply codes in plain words, the phone's status, a reload, and bWalletX's same-phone
 * return (#bwx=ok, src/lib/pair/bwxReturn.ts). The test plays bWalletX at the far end of a mock relay socket.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, PublicKey, type WalletInterface } from '@bsv/sdk';
import {
  startPairing,
  getPhoneStatus,
  getPhoneEnd,
  PairError,
  DECLINED_TEXT,
  REPAIR_TEXT,
  STORE,
  OLD_STORE,
  dropOldPairing,
  CALL_TIMEOUT_MS,
  _setCallTimeoutForTests,
  _forgetPhoneForReload,
  disconnectPhone,
  type PairState,
} from './pair/site';
import { getSiteWallet, pickWallet, _resetSiteWallet, resumeSiteWallet, walletErrorText, returnPage } from './siteWallet';
import { getBarWallet } from './walletBar';
import { BWX_RETURN_SCRIPT, RETURN_GLOBAL, bootReturnHash, pruneConnectReturns, returnRid } from './pair/bwxReturn';
import { PAY_TIMEOUT_MS } from './wallet';

// ---- A browser, enough of it ----

class MockSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static all: MockSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  /** The relay is unreachable: new sockets fail instead of opening. */
  static refuse = false;
  constructor(readonly url: string) {
    MockSocket.all.push(this);
    const refused = MockSocket.refuse;
    setTimeout(() => {
      if (refused) {
        this.readyState = 3;
        this.onerror?.();
        this.onclose?.();
        return;
      }
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
const win = {
  postMessage: () => undefined,
  addEventListener: (t: string, f: () => void) => void (listeners[t] ??= []).push(f),
  removeEventListener: (t: string, f: () => void) => void (listeners[t] = (listeners[t] ?? []).filter((x) => x !== f)),
  dispatchEvent: () => true,
  location: { host: 'www.tokenblaster.lol', search: '' },
} as Record<string, unknown>;
win.self = win.top = win;
g.window = win;
g.document = { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined };
g.Event = class {
  constructor(readonly type: string) {}
};
const loc = { origin: 'https://www.tokenblaster.lol', href: 'https://www.tokenblaster.lol/arcade/terrornode', pathname: '/arcade/terrornode', search: '', hash: '' };
g.location = loc;
g.history = {
  state: null,
  replaceState: (_s: unknown, _t: string, u: string) => {
    loc.hash = '';
    loc.href = new URL(u, loc.origin).href;
  },
};
let fetches: string[] = [];
g.fetch = async (u: string) => (fetches.push(String(u)), { ok: false, status: 404, json: async () => null });
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const setUa = (ua: string) => Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua, maxTouchPoints: 0 }, configurable: true });
setUa(DESKTOP_UA);


const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, what: string, tries = 600) {
  for (let i = 0; i < tries && !ok(); i++) await tick(2);
  if (!ok()) throw new Error(`timed out waiting for ${what}`);
}
const KEY = PrivateKey.fromRandom().toPublicKey().toString();

// ---- bWalletX's side of the pairing protocol (the same bytes bWalletX speaks) ----

const enc = new TextEncoder();
const dec = new TextDecoder();
type Frame = { s: number; n: string; d: string };
type Msg = { t: string; id?: string; action?: string; params?: unknown; result?: unknown; error?: unknown; reason?: string };

async function phoneSession(W: PrivateKey, siteKey: string, channel: string) {
  const point = W.deriveSharedSecret(PublicKey.fromString(siteKey));
  const base = await crypto.subtle.importKey('raw', new Uint8Array(point.encode(true) as number[]), 'HKDF', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: Buffer.from(channel, 'base64url'), info: enc.encode('bwallet-pair-v1') }, base, 256),
  );
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bits));
  let sent = 0;
  let seen = 0;
  return {
    code: String(((h[0] << 8) | h[1]) % 10000).padStart(4, '0'),
    async seal(m: Msg): Promise<Frame> {
      const s = ++sent;
      const n = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: n, additionalData: enc.encode(`wallet|${s}`) }, key, enc.encode(JSON.stringify(m)));
      return { s, n: Buffer.from(n).toString('base64'), d: Buffer.from(new Uint8Array(ct)).toString('base64') };
    },
    async open(f: Frame): Promise<Msg | null> {
      if (!f || f.s <= seen) return null;
      try {
        const pt = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: Buffer.from(f.n, 'base64'), additionalData: enc.encode(`site|${f.s}`) },
          key,
          Buffer.from(f.d, 'base64'),
        );
        seen = f.s;
        return JSON.parse(dec.decode(pt)) as Msg;
      } catch {
        return null;
      }
    },
  };
}
type Phone = Awaited<ReturnType<typeof phoneSession>>;

/** Requests the site sent on `sock`, opened by the phone. */
async function requests(sock: MockSocket, phone: Phone, n = 1) {
  const out: Msg[] = [];
  for (let i = 0; i < 600 && out.length < n; i++) {
    while (sock.sent.length) {
      const m = await phone.open(JSON.parse(sock.sent.shift()!) as Frame);
      if (m?.t === 'req') out.push(m);
    }
    if (out.length < n) await tick(2);
  }
  return out;
}

/** Start the chooser's pairing and play the phone up to (and including) Connect. */
async function pair(opts: { onReady?: (s: Extract<PairState, { k: 'ready' }>) => void } = {}) {
  let link = '';
  let code = '';
  let wallet: WalletInterface | null = null;
  const states: PairState['k'][] = [];
  const stop = startPairing((s) => {
    states.push(s.k);
    if (s.k === 'qr') link = s.link;
    if (s.k === 'code') code = s.code;
    if (s.k === 'ready') {
      wallet = s.wallet;
      opts.onReady?.(s);
    }
  });
  await until(() => !!link, 'the QR');
  const sock = MockSocket.all.at(-1)!;
  const u = new URL(link);
  const W = PrivateKey.fromRandom();
  const phone = await phoneSession(W, u.searchParams.get('k')!, u.searchParams.get('c')!);
  sock.push({ t: 'hello', k: W.toPublicKey().toString(), info: { name: 'bWalletX', rdns: 'space.bwallet.mobile' } });
  await until(() => !!code, 'the code');
  assert.equal(code, phone.code, 'both screens show the same code');
  sock.push(await phone.seal({ t: 'ready' }));
  await until(() => !!wallet, 'ready');
  return { w: wallet as unknown as WalletInterface, sock, phone, link, stop, states };
}

const fresh = () => {
  _forgetPhoneForReload();
  _resetSiteWallet();
  (g.sessionStorage as Storage).clear();
  (g.localStorage as Storage).clear();
  fetches = [];
};

// ---- The relay's 30 Nov 2026 cutoff ----

test('a new channel carries the site claim and wc = SHA-256(walletClaimFor(channel, site key)); no origin proofs', async () => {
  fresh();
  let link = '';
  const stop = startPairing((s) => void (s.k === 'qr' && (link = s.link)));
  await until(() => !!link, 'the QR');
  const sock = MockSocket.all.at(-1)!;
  const url = new URL(sock.url);
  const u = new URL(link);
  const c = u.searchParams.get('c')!;
  const k = u.searchParams.get('k')!;
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.host, 'relay.bwallet.space');
  assert.equal(url.pathname, `/v1/c/${c}`);
  assert.equal(url.searchParams.get('role'), 'site');
  assert.match(url.searchParams.get('e') ?? '', /^\d+$/);
  assert.match(url.searchParams.get('claim') ?? '', /^[A-Za-z0-9_-]{22}$/, 'a site claim on the socket that opens the channel');
  const walletClaim = Buffer.from(await crypto.subtle.digest('SHA-256', enc.encode(`bwallet-pair-wallet-claim-v1|${c}|${k}`))).toString('base64url');
  const wc = Buffer.from(await crypto.subtle.digest('SHA-256', enc.encode(walletClaim))).toString('hex');
  assert.equal(url.searchParams.get('wc'), wc, 'wc binds the wallet role to the phone that scanned the QR');
  // The link: the standard fields, no origin proof (s/s2), and on a computer no return (a QR another device scans).
  assert.equal(u.origin + u.pathname, 'https://www.bwallet.space/pair');
  assert.equal(u.searchParams.get('o'), 'https://www.tokenblaster.lol');
  for (const f of ['s', 's2', 'ret', 'rid']) assert.equal(u.searchParams.get(f), null, f);
  assert.deepEqual(fetches.filter((f) => f.includes('/api/pair')), [], 'no proof route is called');
  stop();
});

test('on a phone the link asks bWalletX to return to this origin ROOT, with a one-time rid', async () => {
  fresh();
  setUa(IPHONE_UA);
  try {
    let link = '';
    const stop = startPairing((s) => void (s.k === 'qr' && (link = s.link)));
    await until(() => !!link, 'the link');
    const u = new URL(link);
    assert.equal(u.searchParams.get('ret'), 'https://www.tokenblaster.lol/', 'the root, never the page or its query');
    assert.match(u.searchParams.get('rid') ?? '', /^[A-Za-z0-9_-]{16,64}$/);
    assert.equal(u.searchParams.get('b'), 'safari');
    stop();
  } finally {
    setUa(DESKTOP_UA);
  }
});

// ---- Pairing, the site wallet, a reload ----

test('ready -> the site wallet is the phone everywhere; a reload restores it and reconnects with the stored claim', async () => {
  fresh();
  const p = await pair({ onReady: (s) => void pickWallet({ id: 'phone', name: `${s.phone} on your phone`, icon: null, kind: 'phone', wallet: s.wallet, fresh: true }) });
  assert.deepEqual(p.states.slice(0, 3), ['starting', 'qr', 'code']);
  const [req] = await requests(p.sock, p.phone);
  assert.equal(req.action, 'getPublicKey');
  p.sock.push(await p.phone.seal({ t: 'res', id: req.id, result: { publicKey: KEY } }));
  await until(() => getSiteWallet().wallet?.id === 'phone', 'the site wallet');
  p.stop();
  assert.equal(getSiteWallet().live, true);
  assert.equal(getBarWallet()?.publicKey, KEY);
  assert.equal(getPhoneStatus(), 'awake');
  const stored = JSON.parse((g.sessionStorage as Storage).getItem(STORE)!) as { v: number; sc: string; c: string };
  assert.equal(stored.v, 1);
  assert.match(stored.sc, /^[A-Za-z0-9_-]{22}$/, 'the site claim is kept with the pairing');

  // Reload: fresh module state, same tab storage. Page load asks the phone nothing: the kept key resumes it.
  _forgetPhoneForReload();
  _resetSiteWallet();
  const before = MockSocket.all.length;
  resumeSiteWallet();
  await until(() => getSiteWallet().wallet?.id === 'phone', 'the resumed wallet', 2000);
  assert.equal(getSiteWallet().wallet?.publicKey, KEY);
  assert.equal(MockSocket.all.length, before, 'no socket, no call on page load');

  // The first call reconnects to the same channel with the stored claim (and no wc: the channel exists).
  const call = getSiteWallet().wallet!.client.listOutputs({ basket: 'ammo' });
  await until(() => MockSocket.all.length > before, 'the reconnect');
  const re = MockSocket.all.at(-1)!;
  const url = new URL(re.url);
  assert.equal(url.pathname, `/v1/c/${stored.c}`);
  assert.equal(url.searchParams.get('claim'), stored.sc);
  assert.equal(url.searchParams.get('wc'), null);
  const [r2] = await requests(re, p.phone);
  re.push(await p.phone.seal({ t: 'res', id: r2.id, result: { outputs: [], totalOutputs: 0 } }));
  assert.deepEqual(await call, { outputs: [], totalOutputs: 0 });
  disconnectPhone();
  assert.equal((g.sessionStorage as Storage).getItem(STORE), null);
});

test('a pairing stored by the hand-rolled code is dropped (no relay claim: dead after 30 Nov), never upgraded', () => {
  const s = mem();
  s.setItem(OLD_STORE, JSON.stringify({ c: 'A'.repeat(22), r: 'relay.bwallet.space', s: 'a'.repeat(64), k: '02' + 'b'.repeat(64), phone: 'bWallet', sent: 3, lastSeen: 2 }));
  dropOldPairing(s);
  assert.equal(s.getItem(OLD_STORE), null);
  assert.equal(s.getItem(STORE), null);
});

// ---- bWallet's reply codes, the phone's status ----

async function refusedWith(code: string, message: string) {
  fresh();
  const p = await pair();
  const call = p.w.getPublicKey({ identityKey: true }).then(
    () => null,
    (x: unknown) => x,
  );
  const [req] = await requests(p.sock, p.phone);
  p.sock.push(await p.phone.seal({ t: 'res', id: req.id, error: { code, message } }));
  const e = (await call) as PairError;
  p.stop();
  return e;
}

test('ERR_PERMISSION_DENIED: "You declined in bWallet", pairing stays', async () => {
  const e = await refusedWith('ERR_PERMISSION_DENIED', 'Permission denied.');
  assert.ok(e instanceof PairError);
  assert.equal(e.code, 'ERR_PERMISSION_DENIED');
  assert.equal(e.message, DECLINED_TEXT);
  assert.equal(walletErrorText(e, { kind: 'phone', name: 'bWallet' }), 'You declined in bWallet.');
  assert.equal(getPhoneStatus(), 'awake');
});

test('REJECTED shows the wallet message; ERROR hints open/unlock; LOCKED says locked', async () => {
  const r = await refusedWith('REJECTED', 'That protocol is reserved.');
  assert.equal(r.code, 'REJECTED');
  assert.match(r.message, /That protocol is reserved/);
  const er = await refusedWith('ERROR', 'Network down');
  assert.match(er.message, /Open and unlock bWallet/);
  assert.doesNotMatch(walletErrorText(er, { kind: 'phone', name: 'x' }), /did not answer/);
  const l = await refusedWith('LOCKED', 'Locked');
  assert.match(l.message, /locked/i);
});

test('REPAIR_NEEDED then close: pairing ended everywhere, fresh-QR text, stored pairing gone', async () => {
  fresh();
  const p = await pair();
  const call = p.w.getPublicKey({ identityKey: true }).catch((x: unknown) => x);
  const other = p.w.listOutputs({ basket: 'x' }).catch((x: unknown) => x);
  const req = (await requests(p.sock, p.phone, 2)).find((r) => r.action === 'getPublicKey')!;
  p.sock.push(await p.phone.seal({ t: 'res', id: req.id, error: { code: 'REPAIR_NEEDED', message: REPAIR_TEXT } }));
  // The pairing is over at once: the other waiting call is refused too, even if the phone's close never arrives.
  const o = (await other) as PairError;
  assert.equal(o.code, 'REPAIR_NEEDED');
  assert.equal((g.sessionStorage as Storage).getItem(STORE), null, 'removed at once: a reload must not resume it');
  p.sock.push(await p.phone.seal({ t: 'close', reason: 'REPAIR_NEEDED' }));
  const e = (await call) as PairError;
  assert.equal(e.code, 'REPAIR_NEEDED');
  assert.equal(e.message, REPAIR_TEXT);
  assert.equal(getPhoneStatus(), 'gone');
  assert.equal(getPhoneEnd()?.code, 'REPAIR_NEEDED');
  await tick(20);
  assert.equal((g.sessionStorage as Storage).getItem(STORE), null);
  p.stop();
});

test("the phone unpairs: 'gone', and the chooser's note says scan the new QR", async () => {
  fresh();
  const p = await pair();
  const call = p.w.getPublicKey({ identityKey: true }).catch((x: unknown) => x);
  await requests(p.sock, p.phone);
  p.sock.push(await p.phone.seal({ t: 'close', reason: 'user unpaired' }));
  const e = (await call) as PairError;
  assert.equal(e.code, 'UNPAIRED');
  assert.equal(getPhoneStatus(), 'gone');
  assert.match(getPhoneEnd()!.message, /Scan the new QR/);
  p.stop();
});

test('the relay says the phone left / rejoined: asleep / awake', async () => {
  fresh();
  const p = await pair();
  assert.equal(getPhoneStatus(), 'awake');
  p.sock.push({ t: 'relay', role: 'wallet', peer: 'left' });
  assert.equal(getPhoneStatus(), 'asleep');
  p.sock.push({ t: 'relay', role: 'wallet', peer: 'joined' });
  assert.equal(getPhoneStatus(), 'awake');
  p.stop();
});

test('after the phone rejoins, an unanswered read is asked again with the SAME id; a spend never is', async () => {
  fresh();
  const p = await pair();
  const read = p.w.listOutputs({ basket: 'ammo' });
  const spend = p.w.createAction({ description: 'ammo', outputs: [] }).catch((x: unknown) => x);
  const first = await requests(p.sock, p.phone, 2);
  assert.deepEqual(first.map((r) => r.action).sort(), ['createAction', 'listOutputs']);
  p.sock.push(await p.phone.seal({ t: 'ready' }));
  const again = await requests(p.sock, p.phone, 1);
  await tick(50);
  assert.deepEqual(
    again.map((r) => [r.id, r.action]),
    first.filter((r) => r.action === 'listOutputs').map((r) => [r.id, r.action]),
  );
  assert.equal((await requests(p.sock, p.phone, 1)).length, 0, 'the spend is not re-sent');
  p.sock.push(await p.phone.seal({ t: 'res', id: again[0].id, result: { outputs: [], totalOutputs: 0 } }));
  assert.deepEqual(await read, { outputs: [], totalOutputs: 0 });
  const spendReq = first.find((r) => r.action === 'createAction')!;
  p.sock.push(await p.phone.seal({ t: 'res', id: spendReq.id, result: { txid: 'ab'.repeat(32) } }));
  assert.deepEqual(await spend, { txid: 'ab'.repeat(32) });
  p.stop();
});

// ---- bWalletX's return (#bwx=ok) ----

test('the boot script moves the return fragment into memory and strips it, on load and on hashchange', () => {
  const l = { hash: '#bwx=ok&rid=AAAAAAAAAAAAAAAAAAAAAA', pathname: '/', search: '?x=1' };
  const replaced: string[] = [];
  const hl: (() => void)[] = [];
  const w: Record<string, unknown> = { location: l, history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => (replaced.push(u), (l.hash = '')) }, addEventListener: (_t: string, f: () => void) => hl.push(f) };
  new Function('window', BWX_RETURN_SCRIPT)(w);
  assert.equal(w[RETURN_GLOBAL], '#bwx=ok&rid=AAAAAAAAAAAAAAAAAAAAAA');
  assert.deepEqual(replaced, ['/?x=1']);
  l.hash = '#other';
  hl[0]();
  assert.equal(replaced.length, 1, 'any other fragment is left alone');
  l.hash = '#bwx=ok&rid=BBBBBBBBBBBBBBBBBBBBBB';
  hl[0]();
  assert.equal(w[RETURN_GLOBAL], '#bwx=ok&rid=BBBBBBBBBBBBBBBBBBBBBB');
  assert.equal(returnRid('#bwx=ok&rid=BBBBBBBBBBBBBBBBBBBBBB&wk=02'), 'BBBBBBBBBBBBBBBBBBBBBB');
  assert.equal(returnRid('#bwx=no&rid=BBBBBBBBBBBBBBBBBBBBBB'), null);
  assert.equal(returnPage(null), null);
});

/** A phone pairing whose player left for bWalletX: connect saved it for the return; this tab is then gone. */
async function leaveForBwallet() {
  setUa(IPHONE_UA);
  let link = '';
  const stop = startPairing((s) => void (s.k === 'qr' && (link = s.link)));
  await until(() => !!link, 'the link');
  setUa(DESKTOP_UA);
  const u = new URL(link);
  const rid = u.searchParams.get('rid')!;
  await until(() => !!(g.localStorage as Storage).getItem(`bwalletx.connect.return.${rid}`), 'the saved return');
  const sock = MockSocket.all.at(-1)!;
  // The player is in bWalletX; this tab goes away (its chooser closes, the saved return stays).
  stop();
  await tick(20);
  return { rid, c: u.searchParams.get('c')!, k: u.searchParams.get('k')!, claim: new URL(sock.url).searchParams.get('claim')! };
}

test('bWalletX returns in a NEW tab: the pairing is finished there and the player goes back to their page', async () => {
  fresh();
  const left = await leaveForBwallet();
  // The new tab: no in-memory state; this test's chooser socket stays silent.
  _forgetPhoneForReload();
  _resetSiteWallet();
  const replaced: string[] = [];
  g.location = Object.assign(loc, { href: 'https://www.tokenblaster.lol/', pathname: '/', hash: '' });
  const realReplace = (loc as unknown as { replace?: (u: string) => void }).replace;
  (loc as unknown as { replace: (u: string) => void }).replace = (u: string) => void replaced.push(u);
  try {
    // The boot script stashed bWalletX's fragment (an older wallet's: rid only, the relay carries hello and ready).
    win[RETURN_GLOBAL] = `#bwx=ok&rid=${left.rid}`;
    const before = MockSocket.all.length;
    resumeSiteWallet();
    assert.equal(getSiteWallet().waiting?.text, 'Finishing the connection with bWallet…');
    await until(() => MockSocket.all.length > before, 'the return socket');
    const sock = MockSocket.all.at(-1)!;
    const url = new URL(sock.url);
    assert.equal(url.pathname, `/v1/c/${left.c}`);
    assert.equal(url.searchParams.get('claim'), left.claim, 'the return tab rejoins with the same site claim');
    assert.equal(bootReturnHash(), '', 'the fragment is taken once');
    await tick(5);
    const W = PrivateKey.fromRandom();
    const phone = await phoneSession(W, left.k, left.c);
    sock.push({ t: 'hello', k: W.toPublicKey().toString(), info: { name: 'bWalletX', rdns: 'space.bwallet.mobile' } });
    await tick(5);
    sock.push(await phone.seal({ t: 'ready' }));
    await until(() => MockSocket.all.length > before + 1, 'the paired socket after the return', 2000);
    const live = MockSocket.all.at(-1)!;
    const [req] = await requests(live, phone);
    assert.equal(req.action, 'getPublicKey');
    live.push(await phone.seal({ t: 'res', id: req.id, result: { publicKey: KEY } }));
    await until(() => getSiteWallet().wallet?.id === 'phone', 'the site wallet');
    assert.equal(getSiteWallet().waiting, null);
    assert.equal(getBarWallet()?.publicKey, KEY);
    await until(() => replaced.length > 0, 'the way back');
    assert.deepEqual(replaced, ['https://www.tokenblaster.lol/arcade/terrornode']);
    assert.equal((g.localStorage as Storage).getItem(`bwalletx.connect.return.${left.rid}`), null, 'the return entry is used up');
  } finally {
    (loc as unknown as { replace?: unknown }).replace = realReplace;
    Object.assign(loc, { href: 'https://www.tokenblaster.lol/arcade/terrornode', pathname: '/arcade/terrornode', hash: '' });
  }
});

test('an unknown or used return id connects nothing, leaves no fragment, and the page resumes as usual', async () => {
  // A phone paired earlier in this tab, then a reload that arrives with a return this browser never started.
  fresh();
  const p = await pair({ onReady: (s) => void pickWallet({ id: 'phone', name: `${s.phone} on your phone`, icon: null, kind: 'phone', wallet: s.wallet, fresh: true }) });
  const [req] = await requests(p.sock, p.phone);
  p.sock.push(await p.phone.seal({ t: 'res', id: req.id, result: { publicKey: KEY } }));
  await until(() => getSiteWallet().wallet?.id === 'phone', 'the site wallet');
  p.stop();
  _forgetPhoneForReload();
  _resetSiteWallet();
  win[RETURN_GLOBAL] = '#bwx=ok&rid=ZZZZZZZZZZZZZZZZZZZZZZ';
  const before = MockSocket.all.length;
  resumeSiteWallet();
  assert.equal(getSiteWallet().waiting?.text, 'Finishing the connection with bWallet…');
  await until(() => getSiteWallet().wallet?.id === 'phone', 'the quiet resume after the empty return', 2000);
  assert.equal(getSiteWallet().wallet?.publicKey, KEY);
  assert.equal(MockSocket.all.length, before, 'no relay socket for a return this browser never started');
  assert.equal(bootReturnHash(), '');
  disconnectPhone();
});

test("page load prunes connect's saved returns that are stale, taken or unreadable", () => {
  const s = mem();
  const now = 10_000_000;
  s.setItem('bwalletx.connect.return.fresh', JSON.stringify({ v: 1, at: now - 60_000 }));
  s.setItem('bwalletx.connect.return.old', JSON.stringify({ v: 1, at: now - 11 * 60_000 }));
  s.setItem('bwalletx.connect.return.taken', JSON.stringify({ v: 1, at: now, taken: now }));
  s.setItem('bwalletx.connect.return.junk', '{');
  s.setItem('other', 'kept');
  pruneConnectReturns(s, now);
  assert.deepEqual([...Array(s.length).keys()].map((i) => s.key(i)).sort(), ['bwalletx.connect.return.fresh', 'other']);
});

test('connect gives up on a call just after fund() does, so a payment the site abandoned is never sent later', async () => {
  // fund() (180 s) times out first and says so; connect's limit is only 5 s longer.
  assert.ok(CALL_TIMEOUT_MS > PAY_TIMEOUT_MS && CALL_TIMEOUT_MS <= PAY_TIMEOUT_MS + 5_000);
  fresh();
  _setCallTimeoutForTests(150);
  try {
    const p = await pair();
    // The relay drops the socket and stays unreachable: the spend can't go out.
    p.sock.readyState = 3;
    p.sock.onclose?.();
    MockSocket.refuse = true;
    const before = MockSocket.all.length;
    const spend = p.w.createAction({ description: 'ammo', outputs: [] }).catch((x: unknown) => x);
    const e = (await spend) as PairError;
    assert.equal(e.code, 'NO_ANSWER', 'never sent');
    assert.ok(MockSocket.all.length > before, 'it did try to reconnect');
    // The relay is back and the phone says ready: only the new read goes out, never the abandoned payment.
    MockSocket.refuse = false;
    const read = p.w.listOutputs({ basket: 'ammo' });
    await until(() => MockSocket.all.at(-1)!.readyState === 1, 'the new socket');
    const sock = MockSocket.all.at(-1)!;
    const [r] = await requests(sock, p.phone);
    sock.push(await p.phone.seal({ t: 'ready' }));
    await tick(50);
    const again = await requests(sock, p.phone, 1);
    for (const m of [r, ...again]) assert.equal(m.action, 'listOutputs');
    sock.push(await p.phone.seal({ t: 'res', id: r.id, result: { outputs: [], totalOutputs: 0 } }));
    assert.deepEqual(await read, { outputs: [], totalOutputs: 0 });
    p.stop();
  } finally {
    MockSocket.refuse = false;
    _setCallTimeoutForTests();
  }
});

test('bWalletX returns to the SAME tab while the chooser waits: that pairing finishes from the fragment', async () => {
  fresh();
  _resetSiteWallet();
  resumeSiteWallet(); // page load: listens for hashchange
  setUa(IPHONE_UA);
  let link = '';
  let code = '';
  let ready: WalletInterface | null = null;
  const stop = startPairing((s) => {
    if (s.k === 'qr') link = s.link;
    if (s.k === 'code') code = s.code;
    if (s.k === 'ready') ready = s.wallet;
  });
  try {
    await until(() => !!link, 'the link');
    const u = new URL(link);
    const rid = u.searchParams.get('rid')!;
    const sock = MockSocket.all.at(-1)!;
    const W = PrivateKey.fromRandom();
    const phone = await phoneSession(W, u.searchParams.get('k')!, u.searchParams.get('c')!);
    const wk = W.toPublicKey().toString();
    // The relay delivered the phone's hello before iOS froze the tab; its ready comes back in the return fragment.
    sock.push({ t: 'hello', k: wk, info: { name: 'bWalletX', rdns: 'space.bwallet.mobile' } });
    await until(() => !!code, 'the code');
    const f = Buffer.from(JSON.stringify(await phone.seal({ t: 'ready' }))).toString('base64url');
    const before = MockSocket.all.length;
    win[RETURN_GLOBAL] = `#bwx=ok&rid=${rid}&wk=${wk}&f=${f}`; // what the boot script stashes
    for (const h of listeners.hashchange ?? []) h();
    await until(() => !!ready, 'ready from the fragment');
    assert.equal(MockSocket.all.length, before, 'no second relay socket: the waiting pairing took its own return');
    assert.equal(bootReturnHash(), '', 'taken');
    assert.equal(getPhoneStatus(), 'awake');
  } finally {
    setUa(DESKTOP_UA);
    stop();
  }
});

/** The site's connect (getPublicKey) after a pairing, answered by the phone on whatever socket the link opens. */
async function answerConnect(phone: Phone, from: number) {
  for (let i = 0; i < 1000 && getSiteWallet().wallet?.id !== 'phone'; i++) {
    for (const sock of MockSocket.all.slice(from)) {
      while (sock.sent.length) {
        const m = await phone.open(JSON.parse(sock.sent.shift()!) as Frame);
        if (m?.t === 'req' && m.action === 'getPublicKey') sock.push(await phone.seal({ t: 'res', id: m.id, result: { publicKey: KEY } }));
      }
    }
    await tick(2);
  }
}

/** A phone pairing in this tab whose player went to bWalletX: the chooser is still waiting. */
async function phoneRound() {
  setUa(IPHONE_UA);
  let link = '';
  let code = '';
  let ready = false;
  const stop = startPairing((s) => {
    if (s.k === 'qr') link = s.link;
    if (s.k === 'code') code = s.code;
    if (s.k === 'ready') ready = true;
  });
  await until(() => !!link, 'the link');
  setUa(DESKTOP_UA);
  const u = new URL(link);
  const rid = u.searchParams.get('rid')!;
  await until(() => !!(g.localStorage as Storage).getItem(`bwalletx.connect.return.${rid}`), 'the saved return');
  const W = PrivateKey.fromRandom();
  const phone = await phoneSession(W, u.searchParams.get('k')!, u.searchParams.get('c')!);
  const wk = W.toPublicKey().toString();
  const fragment = async () => `#bwx=ok&rid=${rid}&wk=${wk}&f=${Buffer.from(JSON.stringify(await phone.seal({ t: 'ready' }))).toString('base64url')}`;
  return { stop, rid, c: u.searchParams.get('c')!, wk, phone, fragment, code: () => code, ready: () => ready };
}

/** bWalletX's return reaches the tab: the boot script stashes it and hashchange fires. */
function returnArrives(hash: string) {
  win[RETURN_GLOBAL] = hash;
  for (const h of [...(listeners.hashchange ?? [])]) h();
}

test('M1: the round ends first (QR refresh / chooser closed), then the return lands in this tab: it still connects', async () => {
  fresh();
  _resetSiteWallet();
  resumeSiteWallet();
  const r = await phoneRound();
  const hash = await r.fragment();
  r.stop(); // the round is cancelled (iOS woke the tab: the overdue refresh fired first)
  const before = MockSocket.all.length;
  returnArrives(hash); // synchronously after: the dead round must not be waited for
  assert.equal(getSiteWallet().waiting?.text, 'Finishing the connection with bWallet…', 'finished the other way at once');
  await until(() => MockSocket.all.length > before, 'the return socket');
  const sock = MockSocket.all.at(-1)!;
  assert.equal(new URL(sock.url).pathname, `/v1/c/${r.c}`);
  await tick(5);
  sock.push({ t: 'hello', k: r.wk, info: { name: 'bWalletX', rdns: 'space.bwallet.mobile' } }); // confirms the fragment
  await answerConnect(r.phone, before);
  assert.equal(getSiteWallet().wallet?.id, 'phone');
  assert.equal(bootReturnHash(), '');
  disconnectPhone();
});

test('M1: the return lands while the round waits (before the phone\'s hello), then the round ends: it still connects', async () => {
  fresh();
  _resetSiteWallet();
  resumeSiteWallet();
  const r = await phoneRound();
  const before = MockSocket.all.length;
  returnArrives(await r.fragment()); // deferred to the waiting round, which keeps it only provisionally (no hello yet)
  await tick(20);
  assert.equal(getSiteWallet().waiting, null, 'left to the waiting round');
  assert.notEqual(bootReturnHash(), '', 'the stash is kept while that round is undecided');
  r.stop(); // then the round is cancelled (refresh timer / expiry / chooser closed)
  await until(() => MockSocket.all.length > before, 'the fallback return socket');
  assert.equal(getSiteWallet().waiting?.text, 'Finishing the connection with bWallet…');
  const sock = MockSocket.all.at(-1)!;
  await tick(5);
  sock.push({ t: 'hello', k: r.wk, info: { name: 'bWalletX', rdns: 'space.bwallet.mobile' } });
  await answerConnect(r.phone, before);
  assert.equal(getSiteWallet().wallet?.id, 'phone');
  assert.equal(r.ready(), false, 'the cancelled round never reported ready');
  assert.equal(bootReturnHash(), '');
  disconnectPhone();
});
