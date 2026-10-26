import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey } from '@bsv/sdk';
import { PairError, pairErrorText, startPairing, getPhoneStatus, getPhoneEnd, openInBwalletUrl, GET_BWALLETX_URL, REPAIR_TEXT, DECLINED_TEXT } from './pair/site';
import { walletErrorText } from './siteWallet';
import { Sealer, deriveSession, parsePairUrl, type PairMessage, type SealedFrame } from './pair/protocol';

// A mock relay: every WebSocket the site opens lands here, and the test plays bWallet on the other end.
type Sent = string;
class MockSocket {
  static OPEN = 1;
  static all: MockSocket[] = [];
  readyState = 0;
  sent: Sent[] = [];
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
const store = new Map<string, string>();
g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
g.location = { origin: 'https://tokenblaster.lol' };


const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** Pair a fake bWallet through the mock relay; returns the site's wallet and the phone's side. */
async function pair() {
  let link = '';
  let wallet: import('@bsv/sdk').WalletInterface | null = null;
  const stop = startPairing((s) => {
    if (s.k === 'qr') link = s.link;
    if (s.k === 'ready') wallet = s.wallet;
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
  while (!wallet) await tick();
  const w = wallet as import('@bsv/sdk').WalletInterface;
  const reqs = async (): Promise<Extract<PairMessage, { t: 'req' }>[]> => {
    const out: Extract<PairMessage, { t: 'req' }>[] = [];
    while (sock.sent.length) {
      const m = await phone.open(JSON.parse(sock.sent.shift()!) as SealedFrame);
      if (m?.t === 'req') out.push(m);
    }
    return out;
  };
  const reply = async (m: PairMessage) => sock.push(await phone.seal(m));
  /** Collect requests until `n` have arrived. Each one is sealed with async WebCrypto before it is sent,
   *  so under load a single tick can see only the first of several; wait on the count, not on a sleep. */
  const reqsN = async (n: number): Promise<Extract<PairMessage, { t: 'req' }>[]> => {
    const out: Extract<PairMessage, { t: 'req' }>[] = [];
    for (let i = 0; i < 400 && out.length < n; i++) {
      out.push(...(await reqs()));
      if (out.length < n) await tick(1);
    }
    return out;
  };
  return { w, sock, phone, reqs, reqsN, reply, link, stop };
}

async function refusedWith(code: string, message: string) {
  const p = await pair();
  const call = p.w.getPublicKey({ identityKey: true });
  // wait for the request to reach the phone (one tick is not enough when the whole suite runs in parallel)
  let req: Awaited<ReturnType<typeof p.reqs>>[number] | undefined;
  for (let i = 0; i < 200 && !req; i++) {
    await tick();
    [req] = await p.reqs();
  }
  if (!req) throw new Error('the request never reached the phone');
  await p.reply({ t: 'res', id: req.id, error: { code, message } });
  const e = await call.then(
    () => null,
    (x: unknown) => x,
  );
  p.stop();
  return e as PairError;
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
  assert.equal(er.code, 'ERROR');
  assert.match(er.message, /Open and unlock bWallet/);
  assert.doesNotMatch(walletErrorText(er, { kind: 'phone', name: 'x' }), /did not answer/);
  const l = await refusedWith('LOCKED', 'Locked');
  assert.match(l.message, /locked/i);
});

test('REPAIR_NEEDED then close: pairing ended, fresh QR text, no retry', async () => {
  const p = await pair();
  const call = p.w.getPublicKey({ identityKey: true }).catch((x: unknown) => x);
  const other = p.w.listOutputs({ basket: 'x' }).catch((x: unknown) => x);
  await tick();
  const [req] = await p.reqs();
  await p.reply({ t: 'res', id: req.id, error: { code: 'REPAIR_NEEDED', message: REPAIR_TEXT } });
  await p.reply({ t: 'close', reason: 'REPAIR_NEEDED' });
  const e = (await call.catch((x: unknown) => x)) as PairError;
  assert.equal(e.code, 'REPAIR_NEEDED');
  assert.equal(e.message, REPAIR_TEXT);
  const o = (await other.catch((x: unknown) => x)) as PairError;
  assert.equal(o.code, 'REPAIR_NEEDED');
  assert.equal(getPhoneStatus(), 'gone');
  assert.equal(getPhoneEnd()?.code, 'REPAIR_NEEDED');
  await tick();
  assert.equal(p.sock.sent.length, 0, 'nothing resent after the pairing ended');
  p.stop();
});

test("close 'user unpaired': gone, show the QR", async () => {
  const p = await pair();
  const call = p.w.getPublicKey({ identityKey: true });
  await tick();
  await p.reqs();
  await p.reply({ t: 'close', reason: 'user unpaired' });
  const e = (await call.catch((x: unknown) => x)) as PairError;
  assert.equal(e.code, 'UNPAIRED');
  assert.equal(getPhoneStatus(), 'gone');
  assert.match(getPhoneEnd()!.message, /Scan the new QR/);
  p.stop();
});

test("{t:'ready'} on rejoin resends outstanding requests with the SAME ids", async () => {
  const p = await pair();
  const a = p.w.getPublicKey({ identityKey: true });
  const b = p.w.listOutputs({ basket: 'ammo' });
  const first = await p.reqsN(2);
  assert.equal(first.length, 2);
  // The phone slept and came back: the relay says joined, then bWallet says ready within 1 s: ONE resend.
  p.sock.push({ t: 'relay', role: 'wallet', peer: 'joined' });
  await tick();
  assert.equal((await p.reqs()).length, 0, 'joined waits briefly for ready');
  await p.reply({ t: 'ready' });
  const again = await p.reqsN(2);
  await tick(1200);
  assert.equal((await p.reqs()).length, 0, 'joined + ready = one resend');
  assert.deepEqual(
    again.map((r) => [r.id, r.action]),
    first.map((r) => [r.id, r.action]),
  );
  // bWallet replays its stored answers for those ids.
  await p.reply({ t: 'res', id: again[0].id, result: { publicKey: '02'.padEnd(66, 'a') } });
  await p.reply({ t: 'res', id: again[1].id, result: { outputs: [], totalOutputs: 0 } });
  assert.deepEqual(await a, { publicKey: '02'.padEnd(66, 'a') });
  assert.deepEqual(await b, { outputs: [], totalOutputs: 0 });
  p.stop();
});

test('pre-#122 bWallet (joined, no ready): resends after ~1 s with the SAME ids, once', async () => {
  const p = await pair();
  const a = p.w.getPublicKey({ identityKey: true });
  await tick();
  const first = await p.reqs();
  p.sock.push({ t: 'relay', role: 'wallet', peer: 'joined' });
  await tick(1200);
  const again = await p.reqs();
  assert.deepEqual(again.map((r) => r.id), first.map((r) => r.id));
  // A late ready right after the fallback resend is deduped too.
  await p.reply({ t: 'ready' });
  await tick();
  assert.equal((await p.reqs()).length, 0);
  await p.reply({ t: 'res', id: again[0].id, result: { publicKey: 'k' } });
  assert.deepEqual(await a, { publicKey: 'k' });
  p.stop();
});

test('links: Open in bWallet = universal link with the QR query; Get bWalletX', async () => {
  const qr = 'https://www.bwallet.space/pair?v=1&r=relay.bwallet.space&c=abc&k=02aa&o=https%3A%2F%2Ftokenblaster.lol&e=9';
  assert.equal(openInBwalletUrl(qr), qr);
  assert.equal(GET_BWALLETX_URL, 'https://bwalletx.com/get');
  assert.equal(pairErrorText('ERR_PERMISSION_DENIED'), 'You declined in bWallet.');
});
