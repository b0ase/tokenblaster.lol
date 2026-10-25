/**
 * GET /api/coins?address=1… → the address's spendable sats coins with each parent tx's hex:
 * [{ txid, vout, sats, hex }]. Server-side because WhatsOnChain rate-limits browsers (503), and
 * GorillaPool's index can lag on mempool spends (it would hand back coins that are already spent).
 */
import { NONE, txHexCached, woc } from '@/lib/wocServer';

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^1[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return Response.json({ error: 'bad address' }, { status: 400 });
  try {
    type U = { tx_hash: string; tx_pos: number; value: number; isSpentInMempoolTx?: boolean };
    const [c, u] = (await Promise.all([woc(`/address/${address}/confirmed/unspent`), woc(`/address/${address}/unconfirmed/unspent`)])).map((x) =>
      x === NONE ? {} : x,
    ) as { result?: U[] }[];
    // 1-sat outputs hold tokens: never treat them as sats.
    const list = [...(c.result ?? []), ...(u.result ?? [])].filter((x) => !x.isSpentInMempoolTx && x.value > 1).slice(0, 200);
    // The browser already holds these txs' bytes: skip them (owner log, 25 Oct: 104 coins took 56 s, one by one).
    const have = new Set((new URL(req.url).searchParams.get('have') ?? '').split(',').filter((t) => /^[0-9a-f]{64}$/.test(t)));
    const need = [...new Set(list.map((x) => x.tx_hash))].filter((t) => !have.has(t));
    const hex = new Map<string, string>();
    // In parallel, 8 at a time, each tx's hex cached for the life of this server instance (a txid never changes).
    for (let i = 0; i < need.length; i += 8) {
      await Promise.all(need.slice(i, i + 8).map(async (t) => hex.set(t, await txHexCached(t))));
    }
    return Response.json(
      list.map((x) => ({ txid: x.tx_hash, vout: x.tx_pos, sats: x.value, ...(have.has(x.tx_hash) ? {} : { hex: hex.get(x.tx_hash) }) })),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    // Upstream trouble: answer a clean empty list (never a 502), cached briefly so a burst of loads doesn't
    // hammer WOC. `x-coins-upstream: failed` lets the gun know the list is unknown, not empty, and ask WOC itself.
    return Response.json([], { headers: { 'cache-control': 'public, max-age=0, s-maxage=10', 'x-coins-upstream': 'failed' } });
  }
}
