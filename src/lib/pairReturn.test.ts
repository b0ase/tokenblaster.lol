import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, PublicKey, Signature } from '@bsv/sdk';
import {
  RET_MAX_BYTES,
  browserHint,
  deriveSession,
  isValidReturnUrl,
  newRequestId,
  pairProofMessageV2,
  pairProofMessageV2String,
  pairUrl,
  parsePairUrl,
  Sealer,
  type PairLink,
} from './pair/protocol';
import { signPairRequestV2 } from './pair/origin-proof';
import { PENDING_PREFIX, PENDING_TTL_MS, parseReturnHash, savePending, takePending } from './pair/returnStore';
import { resumeReturnedPairing, returnFields } from './pair/site';

// ---- mocks: relay sockets and localStorage ----
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
const g = globalThis as Record<string, unknown>;
g.WebSocket = MockSocket;
const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
  clear: () => mem.clear(),
};
g.localStorage = storage;
g.sessionStorage = { ...storage };
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

const TEST_KEY_HEX = '0000000000000000000000000000000000000000000000000000000000000001'; // throwaway test vector
const env = { BWALLETX_PAIR_SIGNING_KEY: TEST_KEY_HEX };
const O = 'https://www.tokenblaster.lol';
const NOW = 1_800_000_000;
const base = (): PairLink => ({
  v: '1',
  r: 'relay.bwallet.space',
  c: 'AAAAAAAAAAAAAAAAAAAAAA',
  k: '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798',
  o: O,
  e: NOW + 100,
});

test('rid: 16 random bytes, base64url (22 chars), new each time', () => {
  const a = newRequestId();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a, newRequestId());
});

test('ret limits: https, our host or a subdomain, no port, no userinfo, no hash, <= 512 bytes', () => {
  assert.equal(isValidReturnUrl(`${O}/terrornode`, O), true);
  assert.equal(isValidReturnUrl('https://arcade.www.tokenblaster.lol/x', O), true);
  assert.equal(isValidReturnUrl('http://www.tokenblaster.lol/x', O), false);
  assert.equal(isValidReturnUrl('https://www.tokenblaster.lol:8443/x', O), false);
  assert.equal(isValidReturnUrl('https://me:pw@www.tokenblaster.lol/x', O), false);
  assert.equal(isValidReturnUrl('https://tokenblaster.lol/x', O), false); // parent domain
  assert.equal(isValidReturnUrl('https://evilwww.tokenblaster.lol/x', O), false); // look-alike
  assert.equal(isValidReturnUrl('https://www.tokenblaster.lol.evil.test/x', O), false);
  assert.equal(isValidReturnUrl(`${O}/x#bwx=ok`, O), false);
  const long = `${O}/${'a'.repeat(RET_MAX_BYTES)}`;
  assert.equal(isValidReturnUrl(long.slice(0, RET_MAX_BYTES), O), true);
  assert.equal(isValidReturnUrl(long.slice(0, RET_MAX_BYTES + 1), O), false);
});

test('b from the UA', () => {
  assert.equal(browserHint('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'safari');
  assert.equal(browserHint('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1'), 'chrome');
  assert.equal(browserHint('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 FxiOS/130.0 Mobile/15E148 Safari/605.1.15'), 'firefox');
  assert.equal(browserHint('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'), 'chrome');
  assert.equal(browserHint('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36'), 'samsung');
  assert.equal(browserHint('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 EdgA/130.0'), 'edge');
  assert.equal(browserHint('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', true), 'brave');
  assert.equal(browserHint('curl/8'), 'other');
});

test('returnFields: this page without its hash; none for http/dev', () => {
  const f = returnFields(`${O}/arcade?x=1#top`, O, 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Safari/604.1');
  assert.equal(f.ret, `${O}/arcade?x=1`);
  assert.match(f.rid!, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(f.b, 'safari');
  assert.deepEqual(returnFields('http://localhost:3000/', 'http://localhost:3000', ''), {});
});

test('link keeps v=1 and s, adds ret/rid/b/s2, and parses back', () => {
  const l = { ...base(), s: '3006020101020101', ret: `${O}/terrornode`, rid: 'Zm9vYmFyYmF6cXV4MTIzNA', b: 'chrome' as const, s2: '3006020102020102' };
  const u = new URL(pairUrl(l));
  assert.equal(u.searchParams.get('v'), '1');
  assert.equal(u.searchParams.get('s'), l.s);
  assert.equal(u.searchParams.get('ret'), l.ret);
  assert.equal(u.searchParams.get('rid'), l.rid);
  assert.equal(u.searchParams.get('b'), 'chrome');
  assert.equal(u.searchParams.get('s2'), l.s2);
  const p = parsePairUrl(u.href, NOW);
  assert.equal(p.ret, l.ret);
  assert.equal(p.rid, l.rid);
  assert.equal(p.b, 'chrome');
  assert.equal(p.s2, l.s2);
  // a v1 link carries none of them
  assert.equal(new URL(pairUrl(base())).searchParams.has('ret'), false);
});

test('s2 signing string, exactly as the wallet builds it', () => {
  const l = { ...base(), ret: `${O}/terrornode`, rid: 'Zm9vYmFyYmF6cXV4MTIzNA', b: 'chrome' };
  assert.equal(
    pairProofMessageV2String(l),
    `bwallet-pair-v2|proof|AAAAAAAAAAAAAAAAAAAAAA|0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798|${O}|${NOW + 100}|${O}/terrornode|Zm9vYmFyYmF6cXV4MTIzNA|chrome`,
  );
  assert.match(pairProofMessageV2String({ ...l, b: undefined }), /\|Zm9vYmFyYmF6cXV4MTIzNA\|$/);
});

test('server signs s2 for our host only; it verifies over the v2 string', () => {
  const pub = PrivateKey.fromHex(TEST_KEY_HEX).toPublicKey().toString();
  const body = { ...base(), ret: `${O}/terrornode`, rid: 'Zm9vYmFyYmF6cXV4MTIzNA', b: 'chrome' };
  const { s, s2 } = signPairRequestV2(body, 'www.tokenblaster.lol', O, env, NOW);
  assert.ok(s && s2);
  assert.ok(PublicKey.fromString(pub).verify(pairProofMessageV2(body), Signature.fromDER(s2!, 'hex')));
  // swapping any field breaks it
  assert.equal(PublicKey.fromString(pub).verify(pairProofMessageV2({ ...body, b: 'safari' }), Signature.fromDER(s2!, 'hex')), false);
  // bad ret / rid / b → v1 only
  assert.equal(signPairRequestV2({ ...body, ret: 'https://evil.test/' }, 'www.tokenblaster.lol', O, env, NOW).s2, null);
  assert.equal(signPairRequestV2({ ...body, rid: 'short' }, 'www.tokenblaster.lol', O, env, NOW).s2, null);
  assert.equal(signPairRequestV2({ ...body, b: 'netscape' }, 'www.tokenblaster.lol', O, env, NOW).s2, null);
  assert.ok(signPairRequestV2({ ...body, b: undefined }, 'www.tokenblaster.lol', O, env, NOW).s2);
  // no key → nothing
  assert.deepEqual(signPairRequestV2(body, 'www.tokenblaster.lol', O, {}, NOW), { s: null, s2: null });
});

test('return hash parsing', () => {
  assert.equal(parseReturnHash('#bwx=ok&rid=Zm9vYmFyYmF6cXV4MTIzNA'), 'Zm9vYmFyYmF6cXV4MTIzNA');
  assert.equal(parseReturnHash('#bwx=no&rid=Zm9vYmFyYmF6cXV4MTIzNA'), null);
  assert.equal(parseReturnHash('#bwx=ok&rid=bad'), null);
  assert.equal(parseReturnHash(''), null);
});

test('stored pairings expire after 10 minutes and are taken once', () => {
  mem.clear();
  const p = { c: 'AAAAAAAAAAAAAAAAAAAAAA', r: 'relay.bwallet.space', s: TEST_KEY_HEX, e: NOW, rid: 'Zm9vYmFyYmF6cXV4MTIzNA', ret: `${O}/`, at: 1_000 };
  savePending(p, storage, 1_000);
  assert.ok(mem.has(PENDING_PREFIX + p.rid));
  assert.equal(takePending(p.rid, storage, 1_000 + PENDING_TTL_MS + 1), null);
  assert.equal(mem.has(PENDING_PREFIX + p.rid), false);
  savePending(p, storage, 1_000);
  assert.deepEqual(takePending(p.rid, storage, 1_000 + PENDING_TTL_MS - 1), p);
  assert.equal(takePending(p.rid, storage, 1_000), null); // once
  // saving prunes stale entries of other rids
  savePending({ ...p, rid: 'b'.repeat(22), at: 0 }, storage, 0);
  savePending(p, storage, PENDING_TTL_MS + 10);
  assert.equal(mem.has(PENDING_PREFIX + 'b'.repeat(22)), false);
});

test('resume via #bwx=ok&rid: rejoins the saved channel, finishes the connect, cleans the hash', async () => {
  mem.clear();
  MockSocket.all = [];
  const S = PrivateKey.fromRandom();
  const c = 'AAAAAAAAAAAAAAAAAAAAAA';
  const rid = newRequestId();
  savePending({ c, r: 'relay.bwallet.space', s: S.toHex(), e: Math.floor(Date.now() / 1000) - 30, rid, ret: `${O}/x`, at: Date.now() });
  let cleaned = '';
  const done = resumeReturnedPairing({ hash: `#bwx=ok&rid=${rid}`, href: `${O}/x#bwx=ok&rid=${rid}` }, (u) => (cleaned = u));
  assert.equal(cleaned, `${O}/x`);
  assert.equal(mem.has(PENDING_PREFIX + rid), false); // single use
  await tick();
  const sock = MockSocket.all.at(-1)!;
  assert.match(sock.url, new RegExp(c));
  const W = PrivateKey.fromRandom();
  sock.push({ t: 'hello', k: W.toPublicKey().toString(), info: { name: 'bWallet', rdns: 'space.bwallet' } });
  const { key } = await deriveSession(W, S.toPublicKey().toString(), c);
  const phone = new Sealer(key, 'wallet');
  await tick();
  sock.push(await phone.seal({ t: 'ready' }));
  const r = await done;
  assert.ok(r);
  assert.equal(r!.phone, 'bWallet');
});

test('resume: unknown or expired rid does nothing (but the hash is still cleaned)', async () => {
  mem.clear();
  MockSocket.all = [];
  let cleaned = '';
  const rid = newRequestId();
  assert.equal(await resumeReturnedPairing({ hash: `#bwx=ok&rid=${rid}`, href: `${O}/#bwx=ok&rid=${rid}` }, (u) => (cleaned = u)), null);
  assert.equal(cleaned, `${O}/`);
  savePending({ c: 'AAAAAAAAAAAAAAAAAAAAAA', r: 'relay.bwallet.space', s: TEST_KEY_HEX, e: 0, rid, ret: `${O}/`, at: Date.now() - PENDING_TTL_MS - 1000 });
  assert.equal(await resumeReturnedPairing({ hash: `#bwx=ok&rid=${rid}`, href: `${O}/` }, () => undefined), null);
  assert.equal(MockSocket.all.length, 0);
  assert.equal(await resumeReturnedPairing({ hash: '', href: `${O}/` }, () => undefined), null);
});
