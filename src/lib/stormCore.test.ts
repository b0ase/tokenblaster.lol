import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, Script, Transaction, Utils } from '@bsv/sdk';
import { MAX_DEPTH, MAX_POST, arcadeBroadcaster, isSeen, runLanes, settleTxs, type Out } from './stormCore';
import { HANDLE_BUDGET, LANE_DEPTH, SPLIT_OUTPUTS, fanoutPlan, galleryPushes, lanesFor, overheadSats, roundHandle, shotSats, needsPaymail } from './gallery';

const key = PrivateKey.fromRandom(); // throwaway: never funded, nothing leaves this process
const priv = Uint8Array.from(key.toArray('be', 32));
const PAYMAIL = 'b0asex@bwalletx.com';

/**
 * Mock ARC: records every posted tx (and which POST it came in) and answers each with `status(i)`; a status ask
 * (GET /v1/tx/:txid) answers `later(txid)` (default SEEN_ON_NETWORK).
 */
function mockArc(status: (i: number) => string, later: (txid: string) => string = () => 'SEEN_ON_NETWORK') {
  const txs: Transaction[] = [];
  const posts: Transaction[][] = [];
  const headers: Record<string, string>[] = [];
  const gets: string[] = [];
  /** txid → index of the POST whose answer said the network has it. */
  const seenAt = new Map<string, number>();
  const f = (async (url: string, init: { method?: string; body: string; headers: Record<string, string> }) => {
    if (init.method !== 'POST') {
      const txid = url.split('/').pop()!;
      gets.push(txid);
      const s = later(txid);
      if (isSeen(s) && !seenAt.has(txid)) seenAt.set(txid, posts.length - 1);
      return { status: 200, json: async () => ({ txid, txStatus: s }) } as unknown as Response;
    }
    headers.push(init.headers);
    const body = JSON.parse(init.body) as { rawTx: string }[];
    const batch: Transaction[] = [];
    posts.push(batch);
    const out = body.map((b) => {
      const tx = Transaction.fromHexEF(b.rawTx);
      txs.push(tx);
      batch.push(tx);
      const s = status(txs.length - 1);
      if (isSeen(s)) seenAt.set(tx.id('hex'), posts.length - 1);
      return { txid: tx.id('hex'), txStatus: s };
    });
    return { status: 200, json: async () => out } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, txs, posts, headers, gets, seenAt };
}
const parentOf = (tx: Transaction) => tx.inputs[0].sourceTXID ?? tx.inputs[0].sourceTransaction?.id('hex');

/** The OP_RETURN's pushes, read from the raw script bytes (OP_FALSE OP_RETURN <push>...). */
const pushesOf = (tx: Transaction) => {
  const b = Uint8Array.from(tx.outputs[0].lockingScript.toBinary());
  assert.deepEqual([b[0], b[1]], [0x00, 0x6a]);
  const out: string[] = [];
  for (let i = 2; i < b.length; ) {
    let len = b[i++];
    if (len === 0x4c) len = b[i++];
    out.push(new TextDecoder().decode(b.slice(i, i + len)));
    i += len;
  }
  return out;
};

async function run(lanes: number, perLane: number, perShot: number, status: (i: number) => string, waitFor?: string, maxDepth?: number, later?: (txid: string) => string) {
  const arc = mockArc(status, later);
  const outs: Out[] = [];
  await runLanes(
    {
      priv,
      token: PAYMAIL,
      baseTxid: 'cd'.repeat(32),
      baseValues: Array.from({ length: lanes }, () => perLane * perShot),
      lanes: Array.from({ length: lanes }, (_, i) => ({ vout: i, count: perLane, n: i * perLane + 1 })),
      step: 100,
      game: 'gallery',
      extra: galleryPushes(roundHandle(PAYMAIL, 'key_0123456789')).slice(1),
      arcs: ['http://mock-arc.invalid'],
      waitFor,
      maxDepth,
    },
    { stopped: () => false, paused: () => false, emit: (o) => outs.push(o), fetch: arc.f, pollMs: 1 },
  );
  return { arc, outs };
}

test('every storm round carries the player paymail in the OP_RETURN, within the per-shot budget', async () => {
  const perShot = shotSats(HANDLE_BUDGET, PAYMAIL.length);
  assert.ok(perShot <= 31, `per-shot ${perShot} sats`);
  const { arc, outs } = await run(3, 40, perShot, () => 'SEEN_ON_NETWORK');
  assert.equal(arc.txs.length, 120, 'every round of every lane is sent (the fee fits the budget)');
  for (const tx of arc.txs) {
    const p = pushesOf(tx);
    assert.deepEqual(p.slice(0, 2), ['tokenblaster.lol', 'sats'], 'push 2 is the ammo, never the paymail (31 Oct 2026)');
    assert.equal(p[3], 'gallery');
    assert.equal(p[4], PAYMAIL, 'the handle push is the paymail');
    const fee = (tx.inputs[0].sourceTransaction?.outputs[tx.inputs[0].sourceOutputIndex].satoshis ?? 0) - (tx.outputs[1].satoshis ?? 0);
    assert.ok(fee <= perShot, `fee ${fee} <= budget ${perShot}`);
    assert.ok((fee * 1000) / tx.toBinary().length >= 100, 'pays >= 100 sat/kB');
  }
  const sent = outs.filter((o) => o.type === 'sent');
  assert.equal(sent.reduce((a, o) => a + (o.type === 'sent' ? o.n : 0), 0), 120);
  assert.equal(sent.reduce((a, o) => a + (o.type === 'sent' ? o.seen : 0), 0), 120);
  assert.equal(arc.headers[0]['X-WaitFor'], 'SEEN_ON_NETWORK', 'ARC holds its answer until the network has the tx');
  assert.equal(arc.headers[0]['X-MaxTimeout'], '8');
});

test('held statuses: the lane waits and asks again before it goes on; orphans are counted, not seen', async () => {
  // Level 1 comes back held (STORED / orphan / seen by turns); a status ask then says the network has it.
  const { arc, outs } = await run(30, 2, 31, (i) => (i < 30 ? ['SEEN_ON_NETWORK', 'STORED', 'SEEN_IN_ORPHAN_MEMPOOL'][i % 3] : 'SEEN_ON_NETWORK'), undefined, 2);
  assert.equal(arc.txs.length, 60, 'every lane still fires both rounds');
  assert.equal(arc.gets.length, 20, 'only the 20 held level-1 txs are asked about');
  const sent = outs.flatMap((o) => (o.type === 'sent' ? [o] : []));
  assert.equal(sent.reduce((a, o) => a + o.n, 0), 60);
  assert.equal(sent.reduce((a, o) => a + o.orphans, 0), 10);
  assert.equal(sent.reduce((a, o) => a + o.seen, 0), 60, '40 seen at once + 20 seen when asked');
  const batches = outs.flatMap((o) => (o.type === 'batch' ? [o] : []));
  assert.equal(batches.reduce((a, b) => a + (b.statuses.SEEN_IN_ORPHAN_MEMPOOL ?? 0), 0), 10, 'per-batch histograms carry the orphan count');
  // A held parent's child is only POSTed after the status ask said seen.
  for (const [k, post] of arc.posts.entries())
    for (const tx of post) {
      const p = parentOf(tx)!;
      if (arc.seenAt.has(p)) assert.ok(arc.seenAt.get(p)! < k, 'parent seen before the child POST');
    }
});

test('wide storm: a POST never holds a parent and its child, every child waits for its parent level, depth <= 2', async () => {
  assert.equal(MAX_DEPTH, LANE_DEPTH);
  const lanes = 700; // more than one POST per level
  const { arc } = await run(lanes, 5, 31, () => 'SEEN_ON_NETWORK', undefined, MAX_DEPTH);
  assert.equal(arc.txs.length, lanes * MAX_DEPTH, 'maxDepth caps each lane at 2 blasts (count 5 asked)');
  const postOf = new Map<string, number>();
  arc.posts.forEach((p, k) => p.forEach((tx) => postOf.set(tx.id('hex'), k)));
  const base = 'cd'.repeat(32);
  const depthOf = (txid: string): number => {
    if (txid === base) return 0;
    const tx = arc.txs.find((t) => t.id('hex') === txid)!;
    return 1 + depthOf(parentOf(tx)!);
  };
  for (const [k, post] of arc.posts.entries()) {
    assert.ok(post.length <= MAX_POST, `POST ${k}: ${post.length} <= ${MAX_POST}`);
    const ids = new Set(post.map((t) => t.id('hex')));
    for (const tx of post) {
      const p = parentOf(tx)!;
      assert.ok(!ids.has(p), `POST ${k} holds a tx and its parent`);
      if (p !== base) assert.ok(postOf.get(p)! < k && arc.seenAt.get(p)! < k, 'the parent was POSTed and seen in an earlier POST');
      assert.ok(depthOf(tx.id('hex')) <= 2, 'depth <= 2 from the fan-out');
    }
    const depths = new Set(post.map((t) => depthOf(t.id('hex'))));
    assert.equal(depths.size, 1, `POST ${k} carries one depth level`);
  }
});

test('a rejected or unanswered tx stops its lane (never re-spends a coin of unknown fate)', async () => {
  const { arc, outs } = await run(4, 2, 31, (i) => (i === 1 ? 'REJECTED' : 'SEEN_ON_NETWORK'), undefined, 2);
  assert.equal(arc.txs.length, 7, 'the rejected lane fires no second round');
  assert.ok(outs.some((o) => o.type === 'why' && /REJECTED/.test(o.text)));
});

test('Arcade broadcaster: POST /txs with the concatenated raw EF bytes, then GET /tx/:txid until seen', async () => {
  const calls: { url: string; method?: string; type?: string; body?: Uint8Array }[] = [];
  const seenAfter = new Map<string, number>();
  const f = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array }) => {
    calls.push({ url, method: init.method, type: init.headers?.['Content-Type'], body: init.body });
    if (init.method === 'POST') return { status: 202, json: async () => ({ submitted: 3, duplicates: 0, total: 3 }) } as unknown as Response;
    const txid = url.split('/').pop()!;
    const k = (seenAfter.get(txid) ?? 0) + 1;
    seenAfter.set(txid, k);
    return { status: 200, json: async () => ({ txid, txStatus: k < 2 ? 'RECEIVED' : 'SEEN_ON_NETWORK' }) } as unknown as Response;
  }) as unknown as typeof fetch;
  const outs: Out[] = [];
  await runLanes(
    { priv, token: 'sats', baseTxid: 'cd'.repeat(32), baseValues: [500, 500, 500], lanes: [0, 1, 2].map((i) => ({ vout: i, count: 2, n: i * 2 + 1 })), maxDepth: 2, broadcaster: 'arcade', arcs: ['http://mock-arcade.invalid'] },
    { stopped: () => false, paused: () => false, emit: (o) => outs.push(o), fetch: f, pollMs: 1 },
  );
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2, 'one POST per depth level');
  for (const p of posts) {
    assert.equal(p.url, 'http://mock-arcade.invalid/txs');
    assert.equal(p.type, 'application/octet-stream');
    assert.ok(p.body instanceof Uint8Array);
  }
  // The body is the three EF txs back to back (each starts version 1 + the EF marker): split and parse them.
  const hex = Utils.toHex([...posts[0].body!]);
  const starts = [...hex.matchAll(/010000000000000000ef/g)].map((x) => x.index!).filter((i) => i % 2 === 0);
  assert.equal(starts.length, 3);
  assert.equal(starts[0], 0, 'nothing before the first tx');
  const txs = starts.map((at, i) => Transaction.fromHexEF(hex.slice(at, starts[i + 1] ?? hex.length)));
  assert.ok(txs.every((t) => t.inputs[0].sourceTXID === 'cd'.repeat(32)), 'level 1 spends the fan-out only');
  const gets = calls.filter((c) => c.method === 'GET');
  assert.ok(gets.length >= 3 && gets.every((g) => /^http:\/\/mock-arcade\.invalid\/tx\/[0-9a-f]{64}$/.test(g.url)), 'status asks hit GET /tx/:txid');
  const sent = outs.flatMap((o) => (o.type === 'sent' ? [o] : []));
  assert.equal(sent.reduce((a, o) => a + o.n, 0), 6);
  assert.ok(outs.some((o) => o.type === 'batch' && o.via === 'arcade'));
});

test('Arcade: a 400 names the bad tx (rejected); a 503 is re-sent with the same bytes', async () => {
  let n = 0;
  const bodies: Uint8Array[] = [];
  const f = (async (_url: string, init: { body: Uint8Array }) => {
    bodies.push(init.body);
    n++;
    if (n === 1) return { status: 503, json: async () => ({ error: 'backpressure' }) } as unknown as Response;
    return { status: 400, json: async () => ({ txid: 'ab'.repeat(32), reason: 'bad script' }) } as unknown as Response;
  }) as unknown as typeof fetch;
  const why: string[] = [];
  const bc = arcadeBroadcaster('http://mock-arcade.invalid', { fetch: f, backoffMs: 1, why: (t) => why.push(t) });
  const res = await bc.post([Uint8Array.of(1, 2), Uint8Array.of(3)], ['ab'.repeat(32), 'cd'.repeat(32)]);
  assert.equal(n, 2);
  assert.deepEqual([...bodies[0]], [1, 2, 3]);
  assert.deepEqual([...bodies[1]], [...bodies[0]], 'same bytes on the resend');
  assert.equal(res[0].txStatus, 'REJECTED');
  assert.equal(res[1].txStatus, 'RECEIVED');
  assert.ok(why.some((w) => /bad script/.test(w)));
});

test('fan-out sizing: lanes <= 2 deep, at most SPLIT_OUTPUTS outputs a tx, funded for every round', () => {
  for (const total of [1, 2, 3, 10_000, 50_000, 1_000_000]) {
    const p = fanoutPlan(total, 31);
    assert.equal(p.lanes, lanesFor(total));
    assert.ok(p.perLane <= LANE_DEPTH && p.lanes * p.perLane >= total, `${total}: ${p.lanes} x ${p.perLane}`);
    assert.ok(p.sizes.every((k) => k <= SPLIT_OUTPUTS));
    assert.equal(p.sizes.reduce((a, b) => a + b, 0), p.lanes);
    assert.equal(p.leaves, p.lanes > SPLIT_OUTPUTS ? Math.ceil(p.lanes / SPLIT_OUTPUTS) : 0);
    assert.ok(p.each >= p.perLane * 31 + 1, 'every lane pays its blasts and keeps >= 1 sat of change');
    assert.ok(p.need >= p.lanes * p.each);
    // The quoted overhead covers the fan-out (what the gun spends beyond the rounds themselves).
    assert.ok(overheadSats(total) + total * 31 >= p.need - 300 - 1000, `${total}: overhead covers the fan-out`);
  }
  assert.equal(fanoutPlan(50_000, 31).leaves, 10); // 25,000 lanes = 10 leaves of 2,500
});

test('settleTxs: POSTs a fan-out level once, then asks until the network has every tx', async () => {
  const arc = mockArc(() => 'STORED', () => 'SEEN_ON_NETWORK');
  const { arcBroadcaster } = await import('./stormCore');
  const bc = arcBroadcaster('http://mock-arc.invalid', { fetch: arc.f, waitFor: 'SEEN_ON_NETWORK' });
  const t = new Transaction();
  t.addInput({ sourceTXID: 'cd'.repeat(32), sourceOutputIndex: 0, unlockingScript: Script.fromASM('OP_TRUE'), sequence: 0xffffffff });
  t.inputs[0].sourceTransaction = undefined;
  t.addOutput({ lockingScript: Script.fromASM('OP_TRUE'), satoshis: 1 });
  // A hand-made EF (the mock reads it back): one input with its source sats and script.
  const src = new Transaction();
  src.addOutput({ lockingScript: Script.fromASM('OP_TRUE'), satoshis: 10 });
  t.inputs[0].sourceTransaction = src;
  t.inputs[0].sourceTXID = src.id('hex');
  const r = await settleTxs(bc, [{ ef: Uint8Array.from(t.toEF()), txid: t.id('hex') }], { pollMs: 1, deadlineMs: 2000 });
  assert.equal(arc.posts.length, 1);
  assert.ok(r.seen.has(t.id('hex')));
  assert.equal(arc.gets.length, 1);
});

test('round handle: the wallet paymail wins, survives a not-answering wallet, key_ name only as a fallback', () => {
  assert.equal(roundHandle(PAYMAIL, ''), PAYMAIL);
  assert.equal(roundHandle(PAYMAIL, 'key_0123456789'), PAYMAIL);
  assert.equal(roundHandle(undefined, 'key_0123456789'), 'key_0123456789');
  assert.equal(roundHandle(null, null), null);
  assert.ok(needsPaymail('key_0123456789') && !needsPaymail(PAYMAIL));
  assert.ok(isSeen('SEEN_ON_NETWORK') && isSeen('MINED') && isSeen('SEEN_MULTIPLE_NODES') && !isSeen('SEEN_IN_ORPHAN_MEMPOOL') && !isSeen('STORED'));
});

test('a stalled ARC POST times out and the same bytes are re-sent; the storm never freezes', async () => {
  const good = mockArc(() => 'SEEN_ON_NETWORK');
  let calls = 0;
  const bodies: string[] = [];
  const f = (async (url: string, init: RequestInit & { body: string; headers: Record<string, string> }) => {
    calls++;
    bodies.push(init.body);
    if (calls === 1) return new Promise(() => {}); // hangs forever, ignores the abort
    return good.f(url, init as never);
  }) as unknown as typeof fetch;
  const outs: Out[] = [];
  const t0 = Date.now();
  await runLanes(
    {
      priv,
      token: PAYMAIL,
      baseTxid: 'cd'.repeat(32),
      baseValues: [10 * 500],
      lanes: [{ vout: 0, count: 10, n: 1 }],
      step: 100,
      arcs: ['http://mock-arc.invalid'],
    },
    { stopped: () => false, paused: () => false, emit: (o) => outs.push(o), fetch: f, postTimeoutMs: 50, postBackoffMs: 1 },
  );
  assert.ok(Date.now() - t0 < 5000);
  assert.ok(calls >= 2);
  assert.equal(bodies[0], bodies[1], 'the resend posts the same txs');
  assert.ok(outs.some((o) => o.type === 'why' && /timed out/.test(o.text)));
  const sent = outs.filter((o) => o.type === 'sent').reduce((a, o) => a + (o.type === 'sent' ? o.n : 0), 0);
  assert.equal(sent, 10);
});

test('an ARC POST that keeps stalling gives up after the bounded tries', async () => {
  let calls = 0;
  const f = (async () => {
    calls++;
    return new Promise(() => {});
  }) as unknown as typeof fetch;
  const outs: Out[] = [];
  await runLanes(
    {
      priv,
      token: PAYMAIL,
      baseTxid: 'cd'.repeat(32),
      baseValues: [10 * 500],
      lanes: [{ vout: 0, count: 10, n: 1 }],
      step: 100,
      arcs: ['http://mock-arc.invalid'],
    },
    { stopped: () => false, paused: () => false, emit: (o) => outs.push(o), fetch: f, postTimeoutMs: 30, postBackoffMs: 1 },
  );
  assert.equal(calls, 3);
  assert.ok(!outs.some((o) => o.type === 'sent'));
});
