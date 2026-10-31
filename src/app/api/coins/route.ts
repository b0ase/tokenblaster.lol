/**
 * GET /api/coins?address=1… → the address's spendable sats coins with each parent tx's hex:
 * [{ txid, vout, sats, hex }]. With `&amounts=1` the hex is left out ([{ txid, vout, sats }]): enough for the
 * CREDIT, two WOC calls, so the first read on page load is fast. The hex is fetched only when a spend needs it. Server-side because WhatsOnChain rate-limits browsers (503), and
 * GorillaPool's index can lag on mempool spends (it would hand back coins that are already spent).
 */
import { NONE, txHexBulk, woc } from '@/lib/wocServer';
import { allUnspent, spendableSats, type UtxoPage } from '@/lib/creditRead';

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^1[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return Response.json({ error: 'bad address' }, { status: 400 });
  try {
    // Every page (src/lib/creditRead.ts): a storm leaves thousands of lane ends, and a big coin can sit on page 8.
    const [c, u] = await Promise.all([
      allUnspent(async (token) => {
        const r = await woc(`/address/${address}/confirmed/unspent${token ? `?limit=1000&token=${encodeURIComponent(token)}` : ''}`);
        return r === NONE ? null : (r as UtxoPage);
      }, 40, 350),
      woc(`/address/${address}/unconfirmed/unspent`).then((r) => (r === NONE ? [] : ((r as UtxoPage)?.result ?? []))),
    ]);
    const all = [...c.coins, ...u];
    // 1-sat outputs hold tokens: never treat them as sats. Largest first: a wide storm leaves thousands of tiny lane
    // ends at the gun (26 Oct 2026), and the 200 we hand back must be the ones worth spending.
    const list = all
      .filter((x) => !x.isSpentInMempoolTx && x.value > 1)
      .sort((a, b) => b.value - a.value)
      .slice(0, 200);
    const total = { 'x-coins-total': String(spendableSats(all)), 'x-coins-complete': c.complete ? '1' : '0' };
    if (new URL(req.url).searchParams.get('amounts') === '1') {
      return Response.json(list.map((x) => ({ txid: x.tx_hash, vout: x.tx_pos, sats: x.value })), { headers: { 'cache-control': 'no-store', ...total } });
    }
    // The browser already holds these txs' bytes: skip them (owner log, 25 Oct: 104 coins took 56 s, one by one).
    const have = new Set((new URL(req.url).searchParams.get('have') ?? '').split(',').filter((t) => /^[0-9a-f]{64}$/.test(t)));
    const need = [...new Set(list.map((x) => x.tx_hash))].filter((t) => !have.has(t));
    // WOC's bulk endpoint, 20 per call; cached for the life of this server instance (a txid never changes).
    // A tx it could not fetch goes back without hex: the browser fetches that one itself via /api/tx.
    const hex = await txHexBulk(need);
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
