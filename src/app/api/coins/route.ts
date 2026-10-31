/**
 * GET /api/coins?address=1… → the address's spendable sats coins with each parent tx's hex:
 * [{ txid, vout, sats, hex }]. With `&amounts=1` the hex is left out ([{ txid, vout, sats }]): enough for the
 * CREDIT, two WOC calls, so the first read on page load is fast. The hex is fetched only when a spend needs it. Server-side because WhatsOnChain rate-limits browsers (503), and
 * GorillaPool's index can lag on mempool spends (it would hand back coins that are already spent).
 */
import { NONE, txHexBulk, woc } from '@/lib/wocServer';
import { allUnspent, spendableSats, type UtxoPage } from '@/lib/creditRead';

// Perf (31 Oct 2026): a stormed gun holds ~16,000 dust outputs, so the confirmed read is ~17 WOC pages 350 ms
// apart (~10 s). Identical reads share one in-flight request, and the amounts-only CREDIT read reuses a confirmed
// read up to CREDIT_TTL_MS old on this instance. Spends (no `amounts`) only share a read still in flight, so they
// never build on a stale list; the unconfirmed list (and its mempool spends) is always read fresh.
const CREDIT_TTL_MS = 20_000;
type Confirmed = Awaited<ReturnType<typeof allUnspent>>;
const confirmedReads = new Map<string, { at: number; done: boolean; p: Promise<Confirmed> }>();
function readConfirmed(address: string, maxAgeMs: number): Promise<Confirmed> {
  const hit = confirmedReads.get(address);
  if (hit && (!hit.done || Date.now() - hit.at < maxAgeMs)) return hit.p;
  const entry = { at: Date.now(), done: false, p: null as unknown as Promise<Confirmed> };
  entry.p = allUnspent(async (token) => {
    const r = await woc(`/address/${address}/confirmed/unspent${token ? `?limit=1000&token=${encodeURIComponent(token)}` : ''}`);
    return r === NONE ? null : (r as UtxoPage);
  }, 40, 350).then(
    (v) => ((entry.done = true), (entry.at = Date.now()), v),
    (e) => {
      confirmedReads.delete(address);
      throw e;
    },
  );
  confirmedReads.set(address, entry);
  if (confirmedReads.size > 500) confirmedReads.delete(confirmedReads.keys().next().value as string);
  return entry.p;
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^1[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return Response.json({ error: 'bad address' }, { status: 400 });
  try {
    // Every page (src/lib/creditRead.ts): a storm leaves thousands of lane ends, and a big coin can sit on page 8.
    const [c, u] = await Promise.all([
      readConfirmed(address, new URL(req.url).searchParams.get('amounts') === '1' ? CREDIT_TTL_MS : 0),
      woc(`/address/${address}/unconfirmed/unspent`).then((r) => (r === NONE ? [] : ((r as UtxoPage)?.result ?? []))),
    ]);
    const all = [...c.coins, ...u];
    // 1-sat outputs hold tokens: never treat them as sats. Largest first: a wide storm leaves thousands of tiny lane
    // ends at the gun (26 Oct 2026), and the 200 we hand back must be the ones worth spending.
    const sorted = all.filter((x) => !x.isSpentInMempoolTx && x.value > 1).sort((a, b) => b.value - a.value);
    // `&min=N` (the gun's LOCK & LOAD read, 31 Oct 2026): leave out lane ends under N sats when bigger coins exist.
    // A stormed gun holds ~16,000 35-sat ends; merging 200 of them meant 200 parent txs to fetch and a load that
    // timed out. The dust stays at the address (UNLOAD's sweep reads without `min`, so it still gets everything).
    const min = Math.max(0, Number(new URL(req.url).searchParams.get('min')) || 0);
    const big = min ? sorted.filter((x) => x.value >= min) : sorted;
    const list = (big.length ? big : sorted).slice(0, 200);
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
