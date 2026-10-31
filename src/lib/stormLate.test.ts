import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey } from '@bsv/sdk';
import { runLanes, type Out } from './stormCore';

const priv = Uint8Array.from(PrivateKey.fromRandom().toArray('be', 32)); // throwaway, never funded

test('regression 31 Oct: rounds count as sent within 2 s when Arcade only reports SEEN late', async () => {
  const t0 = Date.now();
  const f = (async (url: string, init: { method?: string }) => {
    if (init.method === 'POST') return { status: 202, json: async () => ({ submitted: 4 }) } as unknown as Response;
    const txid = url.split('/').pop()!;
    return { status: 200, json: async () => ({ txid, txStatus: Date.now() - t0 > 400 ? 'SEEN_ON_NETWORK' : 'ANNOUNCED_TO_NETWORK' }) } as unknown as Response;
  }) as unknown as typeof fetch;
  let firstSent = 0;
  const outs: Out[] = [];
  await runLanes(
    { priv, token: 'sats', baseTxid: 'ab'.repeat(32), baseValues: [500, 500, 500, 500], lanes: [0, 1, 2, 3].map((i) => ({ vout: i, count: 2, n: i * 2 + 1 })), maxDepth: 2, broadcaster: 'arcade', arcs: ['http://mock-arcade.invalid'] },
    { stopped: () => false, paused: () => false, emit: (o) => { if (o.type === 'sent' && o.n && !firstSent) firstSent = Date.now() - t0; outs.push(o); }, fetch: f, pollMs: 20 },
  );
  assert.ok(firstSent > 0 && firstSent < 2000, `first sent after ${firstSent} ms`);
  assert.equal(outs.reduce((a, o) => a + (o.type === 'sent' ? o.n : 0), 0), 8);
});
