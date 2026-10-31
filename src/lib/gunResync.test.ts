import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyResync, checkOutpoint, resyncCandidates, resyncCheck, resyncMessage } from './gunResync';

const T = (c: string) => c.repeat(64);
const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(status === 404 ? 'not found' : JSON.stringify(body), { status, headers });
/** A mock network: url substring → queue of responses (last one repeats). Records every call. */
function net(routes: Record<string, Response[]>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const k = Object.keys(routes).find((x) => url.includes(x));
    if (!k) throw new Error(`unmocked ${url}`);
    const q = routes[k];
    return (q.length > 1 ? q.shift()! : q[0]).clone();
  };
  const sleeps: number[] = [];
  return { calls, sleeps, d: { fetch, sleep: async (ms: number) => void sleeps.push(ms), paceMs: 100 } };
}

test('stuck coin: unspent on chain, no broadcaster knows the spender → freed', async () => {
  const n = net({ [`/tx/${T('a')}/0/spent`]: [res(404)], '/api/spends/': [res(200, '')], [`arcade.gorillapool.io/tx/${T('f')}`]: [res(404)], [`arc.gorillapool.io/v1/tx/${T('f')}`]: [res(404)] });
  const r = await checkOutpoint({ txid: T('a'), vout: 0, sats: 11_718_522, spenders: [T('f')] }, n.d);
  assert.equal(r.verdict, 'freed');
  const spent = new Set([`${T('a')}_0`, `${T('b')}_1`]);
  assert.deepEqual(applyResync(spent, [r]), [`${T('a')}_0`]);
  assert.deepEqual([...spent], [`${T('b')}_1`], 'only the freed outpoint is cleared');
});

test('spender still held by Arcade or ARC → stays spent (pending on network)', async () => {
  for (const held of ['arcade', 'arc']) {
    const n = net({
      [`/tx/${T('a')}/0/spent`]: [res(404)],
      '/api/spends/': [res(200, '')],
      [`arcade.gorillapool.io/tx/`]: [held === 'arcade' ? res(200, { txStatus: 'SEEN_ON_NETWORK' }) : res(404)],
      [`arc.gorillapool.io/v1/tx/`]: [res(200, { txStatus: 'STORED' })],
    });
    const r = await checkOutpoint({ txid: T('a'), vout: 0, sats: 5000, spenders: [T('f')] }, n.d);
    assert.equal(r.verdict, 'pending', held);
    const spent = new Set([`${T('a')}_0`]);
    assert.deepEqual(applyResync(spent, [r]), []);
    assert.equal(spent.size, 1);
  }
});

test('confirmed-spent coin stays spent and the broadcasters are not even asked', async () => {
  const n = net({ [`/tx/${T('a')}/0/spent`]: [res(200, { txid: T('c'), vin: 0, status: 'confirmed' })] });
  const r = await checkOutpoint({ txid: T('a'), vout: 0, sats: 5000, spenders: [T('f')] }, n.d);
  assert.equal(r.verdict, 'spent');
  assert.equal(n.calls.length, 1);
});

test('WOC lags: says unspent, GorillaPool knows the spender → stays spent (owner 182ec682…:33 case)', async () => {
  const n = net({ '/api/spends/': [res(200, T('9'))], '/spent': [res(404)] });
  const r = await checkOutpoint({ txid: T('a'), vout: 33, sats: 163_544 }, n.d);
  assert.equal(r.verdict, 'spent');
});

test('unreadable answers keep the coin spent (WOC 5xx, broadcaster down)', async () => {
  const a = net({ '/spent': [res(503)] });
  assert.equal((await checkOutpoint({ txid: T('a'), vout: 0, sats: 5000 }, a.d)).verdict, 'unknown');
  const b = net({ '/spent': [res(404)], '/api/spends/': [res(200, '')], arcade: [res(500)] });
  assert.equal((await checkOutpoint({ txid: T('a'), vout: 0, sats: 5000, spenders: [T('f')] }, b.d)).verdict, 'unknown');
});

test('429 pacing: backs off (Retry-After, then doubling) and retries', async () => {
  const n = net({ '/api/spends/': [res(200, '')], '/spent': [res(429, {}, { 'retry-after': '2' }), res(429), res(404)], arcade: [res(404)], 'arc.gorillapool.io/v1': [res(404)] });
  const r = await checkOutpoint({ txid: T('a'), vout: 0, sats: 5000, spenders: [T('f')] }, n.d);
  assert.equal(r.verdict, 'freed');
  assert.deepEqual(n.sleeps, [2000, 200]);
  const stuck = net({ '/spent': [res(429)] });
  assert.equal((await checkOutpoint({ txid: T('a'), vout: 0, sats: 5000 }, stuck.d)).verdict, 'unknown', 'endless 429 keeps it spent');
});

test('candidates: journal ∩ chain unspent, dust skipped, largest first; message', async () => {
  const spent = new Set([`${T('a')}_0`, `${T('b')}_0`, `${T('d')}_3`]);
  const chain = [{ txid: T('a'), vout: 0, sats: 5_843_682 }, { txid: T('b'), vout: 0, sats: 11_718_522 }, { txid: T('d'), vout: 3, sats: 6 }, { txid: T('e'), vout: 0, sats: 9000 }];
  const c = resyncCandidates(spent, chain, () => [T('f')]);
  assert.deepEqual(c.map((x) => x.sats), [11_718_522, 5_843_682]);
  const n = net({ '/api/spends/': [res(200, '')], '/spent': [res(404)], arcade: [res(404)], 'arc.gorillapool.io/v1': [res(404)] });
  const r = await resyncCheck(c, n.d);
  assert.equal(r.filter((x) => x.verdict === 'freed').length, 2);
  assert.equal(resyncMessage(r, 17), "Found $2.99 that was stuck — it's back in your credit");
});
