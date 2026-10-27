/** TERRORNODE revenue split: 50/50 amounts, destination pinning, exact verification, idempotent settlement. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2PKH, PrivateKey, Script, Transaction } from '@bsv/sdk';
import { PAYEES, pinned, pinnedQuote, readSplit, splitOutputs, splitSats } from './launch/split';
import { _resetPayeeCache, checkPayees, notifySplit, resolveDest, resolveSplit } from './launch/payees';
import { RECEIPT_GAS, readSettlement, settlementAsm } from './launch/receipts';
import { testDest, testQuote } from './splitFixture';
import { LIMIT, _resetSplitGate, checkCached, markUsed, quoteFor } from './launch/splitGate';

const POOL = PrivateKey.fromRandom().toAddress();
const payTx = (outs: { address: string; sats: number }[]) => {
  const t = new Transaction();
  for (const o of outs) t.addOutput({ lockingScript: new P2PKH().lock(o.address), satoshis: o.sats });
  return t;
};

test('split: even totals halve, the odd sat goes to bCorp', () => {
  assert.deepEqual(splitSats(1000), { npg: 500, bcorp: 500 });
  assert.deepEqual(splitSats(1001), { npg: 500, bcorp: 501 });
  assert.deepEqual(splitSats(1), { npg: 0, bcorp: 1 });
  assert.deepEqual(splitSats(0), { npg: 0, bcorp: 0 });
  const q = testQuote();
  assert.deepEqual(splitOutputs(q, 7), [{ address: q.npg.address, sats: 3 }, { address: q.bcorp.address, sats: 4 }]);
  assert.deepEqual(splitOutputs(q, 1), [{ address: q.bcorp.address, sats: 1 }]);
});

test('pinning: a destination must re-derive from the pinned key', () => {
  const d = testDest('npg');
  assert.ok(pinned(d, 'npg'));
  assert.equal(pinned(d, 'bcorp'), false); // NPG's derivation is not bCorp's
  assert.equal(pinned({ ...d, address: PrivateKey.fromRandom().toAddress() }, 'npg'), false);
  assert.equal(pinned({ ...d, suffix: testDest('npg').suffix }, 'npg'), false);
  const q = testQuote();
  assert.ok(pinnedQuote(q));
  assert.equal(pinnedQuote({ npg: q.npg, bcorp: { ...q.npg, payee: 'bcorp' } }), false);
});

test('verification: exactly the quoted 50/50 outputs pass; anything else is refused', () => {
  const q = testQuote();
  assert.deepEqual(readSplit(payTx(splitOutputs(q, 1001)), q), { ok: true, paid: BigInt(1001), npg: 500, bcorp: 501 });
  assert.equal(readSplit(payTx([{ address: q.npg.address, sats: 600 }, { address: q.bcorp.address, sats: 400 }]), q).ok, false);
  assert.equal(readSplit(payTx([{ address: q.npg.address, sats: 1000 }]), q).ok, false);
  const other = PrivateKey.fromRandom().toAddress();
  assert.equal(readSplit(payTx([{ address: other, sats: 500 }, { address: q.bcorp.address, sats: 500 }]), q).ok, false);
  // A quote pointing at someone else's address is refused even if the tx pays it 50/50.
  const forged = { ...q, npg: { ...q.npg, address: other } };
  assert.equal(readSplit(payTx([{ address: other, sats: 500 }, { address: q.bcorp.address, sats: 500 }]), forged).ok, false);
});

test('settlement: the tag carries the split; the server re-derives it and refuses a tampered one', async () => {
  const q = testQuote();
  const mk = (outs: { address: string; sats: number }[], quote = q) => {
    const t = new Transaction();
    t.addOutput({ lockingScript: Script.fromASM(settlementAsm({ count: 5, recipient: POOL, session: 's', handle: '' }, quote)), satoshis: 0 });
    for (const o of outs) t.addOutput({ lockingScript: new P2PKH().lock(o.address), satoshis: o.sats });
    t.addOutput({ lockingScript: new P2PKH().lock(POOL), satoshis: RECEIPT_GAS });
    return t;
  };
  const ok = readSettlement(mk(splitOutputs(q, 11)), POOL);
  assert.equal(ok?.paid, BigInt(11));
  assert.equal(ok?.split?.npg.address, q.npg.address);
  const skew = readSettlement(mk([{ address: q.npg.address, sats: 1 }, { address: q.bcorp.address, sats: 10 }]), POOL);
  assert.equal(skew?.paid, BigInt(0));
  assert.match(skew?.splitError ?? '', /50\/50/);
  // The tag names a derivation, the outputs pay an address that isn't it: nothing counts as paid.
  const other = testQuote();
  const wrong = readSettlement(mk(splitOutputs(other, 10), q), POOL);
  assert.equal(wrong?.paid, BigInt(0));
});

// ── Resolution against a mock paymail server ──────────────

function mockPaymail(o: { pubkeys?: Partial<Record<string, string>>; badScript?: boolean; receive?: (alias: string, body: { reference: string; hex: string }) => number } = {}) {
  const issued = new Map<string, { alias: string; dest: ReturnType<typeof testDest>; txid?: string }>();
  const calls: string[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push(url);
    const j = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/.well-known/bsvalias'))
      return j({ capabilities: { pki: 'https://pm.test/id/{alias}@{domain.tld}', '2a40af698840': 'https://pm.test/p2p/{alias}@{domain.tld}', '5f1323cddf31': 'https://pm.test/rx/{alias}@{domain.tld}' } });
    const alias = url.split('/').pop()!.split('@')[0];
    const p = PAYEES.find((x) => x.alias === alias)!;
    if (url.includes('/id/')) return j({ handle: p.paymail, pubkey: o.pubkeys?.[alias] ?? p.identityKey });
    if (url.includes('/p2p/')) {
      const dest = testDest(p.id);
      issued.set(dest.reference, { alias, dest });
      const script = o.badScript ? new P2PKH().lock(PrivateKey.fromRandom().toAddress()).toHex() : new P2PKH().lock(dest.address).toHex();
      return j({ outputs: [{ script, satoshis: 1, derivationPrefix: dest.prefix, derivationSuffix: dest.suffix, senderIdentityKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' }], reference: dest.reference });
    }
    if (url.includes('/rx/')) {
      const b = JSON.parse(String(init?.body)) as { reference: string; hex: string };
      if (o.receive) return j({}, o.receive(alias, b));
      const r = issued.get(b.reference);
      if (!r || r.alias !== alias) return j({ error: 'unknown-reference' }, 404);
      const txid = Transaction.fromHex(b.hex).id('hex');
      if (r.txid && r.txid !== txid) return j({ error: 'reference-already-used' }, 409);
      r.txid = txid;
      return j({ txid });
    }
    return j({}, 404);
  };
  return { f: f as typeof fetch, calls };
}

test('resolve: both destinations pinned; a paymail with another identity key is refused', async () => {
  _resetPayeeCache();
  const good = mockPaymail();
  const q = await resolveSplit(good.f);
  assert.ok(pinnedQuote(q));
  await checkPayees(good.f);

  _resetPayeeCache();
  const swapped = mockPaymail({ pubkeys: { bcorp: PrivateKey.fromRandom().toPublicKey().toString() } });
  await assert.rejects(resolveSplit(swapped.f), /pinned identity key/);
  _resetPayeeCache();
  await assert.rejects(checkPayees(swapped.f), /pinned identity key/);

  _resetPayeeCache();
  await assert.rejects(resolveDest('npg', mockPaymail({ badScript: true }).f), /not its pinned key/);
  _resetPayeeCache();
});

test('notify: credits each non-zero half, idempotent per txid, refuses a reference it did not issue', async () => {
  _resetPayeeCache();
  const pm = mockPaymail();
  const q = await resolveSplit(pm.f);
  const tx = payTx(splitOutputs(q, 101));
  assert.deepEqual(await notifySplit(tx.toHex(), q, 101, pm.f), { ok: true });
  assert.deepEqual(await notifySplit(tx.toHex(), q, 101, pm.f), { ok: true }); // same txid again: fine
  const other = payTx(splitOutputs(q, 50));
  assert.equal((await notifySplit(other.toHex(), q, 50, pm.f)).ok, false); // reference already used by another tx
  const made = testQuote(); // derives correctly but the paymail server never issued it
  const r = await notifySplit(payTx(splitOutputs(made, 10)).toHex(), made, 10, pm.f);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.retry, false);
  const down = mockPaymail({ receive: () => 503 });
  _resetPayeeCache();
  const r2 = await notifySplit(tx.toHex(), q, 101, down.f);
  assert.equal(!r2.ok && r2.retry, true);
  _resetPayeeCache();
});

// ── Guards: the check never uses up destinations; quotes are rate-limited and reused ──────────────

test('check: zero p2p calls, and repeated checks within 60 s hit the cache', async () => {
  _resetPayeeCache();
  _resetSplitGate();
  const pm = mockPaymail();
  const t = 1_000_000;
  assert.deepEqual(await checkCached(pm.f, t), { ok: true });
  const after1 = pm.calls.length;
  for (let i = 0; i < 50; i++) assert.equal((await checkCached(pm.f, t + 1000 + i)).ok, true);
  assert.equal(pm.calls.length, after1); // cached: nothing more was fetched
  assert.equal(pm.calls.filter((u) => u.includes('/p2p/')).length, 0);
  // Concurrent page loads share one lookup.
  _resetPayeeCache();
  _resetSplitGate();
  const pm2 = mockPaymail();
  await Promise.all(Array.from({ length: 20 }, () => checkCached(pm2.f, t)));
  assert.equal(pm2.calls.filter((u) => u.endsWith('/.well-known/bsvalias')).length, 1);
  assert.equal(pm2.calls.filter((u) => u.includes('/p2p/')).length, 0);
  // A key mismatch is reported (and cached) without any p2p call either.
  _resetPayeeCache();
  _resetSplitGate();
  const bad = mockPaymail({ pubkeys: { npg: PrivateKey.fromRandom().toPublicKey().toString() } });
  assert.equal((await checkCached(bad.f, t)).ok, false);
  assert.equal(bad.calls.filter((u) => u.includes('/p2p/')).length, 0);
  _resetPayeeCache();
  _resetSplitGate();
});

test('quote: an unused quote is reused on retry; rate-limited per wallet and per IP; a used quote is not reused', async () => {
  _resetPayeeCache();
  _resetSplitGate();
  const pm = mockPaymail();
  const p2p = () => pm.calls.filter((u) => u.includes('/p2p/')).length;
  const t = 5_000_000;
  const a = await quoteFor({ ip: '1.1.1.1', who: 'gunA1234', purpose: 'fee' }, pm.f, t);
  assert.ok(a.ok);
  assert.equal(p2p(), 2);
  for (let i = 0; i < 10; i++) {
    const r = await quoteFor({ ip: '1.1.1.1', who: 'gunA1234', purpose: 'fee' }, pm.f, t + i);
    assert.ok(r.ok && r.reused && r.quote.npg.reference === (a.ok && a.quote.npg.reference));
  }
  assert.equal(p2p(), 2); // retries cost nothing
  // Once paid, the next session for the same wallet gets new destinations, up to LIMIT.perWho a minute.
  let fetched = 1;
  for (let i = 0; i < 10; i++) {
    const last = await quoteFor({ ip: '1.1.1.1', who: 'gunA1234', purpose: 'fee' }, pm.f, t + 100 + i);
    if (last.ok) {
      if (!last.reused) fetched++;
      markUsed(last.quote);
    } else assert.equal(last.status, 429);
  }
  assert.equal(fetched, LIMIT.perWho);
  // Per IP: many wallet ids from one IP are capped too.
  const ipT = t + 10 * 60_000;
  let ok = 0;
  for (let i = 0; i < 20; i++) if ((await quoteFor({ ip: '2.2.2.2', who: `w${i}xxxxx`, purpose: 'fee' }, pm.f, ipT)).ok) ok++;
  assert.equal(ok, LIMIT.perIp);
  // After the window passes, requests are allowed again.
  assert.ok((await quoteFor({ ip: '2.2.2.2', who: 'wNEWxxxx', purpose: 'fee' }, pm.f, ipT + LIMIT.window + 1)).ok);
  _resetPayeeCache();
  _resetSplitGate();
});
