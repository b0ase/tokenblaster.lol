/**
 * GET /api/coins?address=1… → the address's spendable sats coins with each parent tx's hex:
 * [{ txid, vout, sats, hex }]. Server-side because WhatsOnChain rate-limits browsers (503), and
 * GorillaPool's index can lag on mempool spends (it would hand back coins that are already spent).
 */
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';

/** WOC answers 404 for an address it has never seen (a fresh gun): that means no coins, not an error. */
const NONE = Symbol('none');

async function woc(path: string, text = false): Promise<unknown> {
  for (let i = 0; ; i++) {
    // Keep well inside the function timeout: 3 tries with a 4s cap each, short backoff.
    const r = await fetch(`${WOC}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (r?.ok) return text ? r.text() : r.json();
    if (r?.status === 404) return NONE;
    if (i >= 2) throw new Error(`WOC ${r ? r.status : 'timeout'}`);
    await new Promise((ok) => setTimeout(ok, 400 * (i + 1)));
  }
}

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
    const hex = new Map<string, string>();
    for (const x of list) {
      if (hex.has(x.tx_hash)) continue;
      const h = await woc(`/tx/${x.tx_hash}/hex`, true);
      if (h === NONE) throw new Error('WOC tx 404');
      hex.set(x.tx_hash, h as string);
    }
    return Response.json(
      list.map((x) => ({ txid: x.tx_hash, vout: x.tx_pos, sats: x.value, hex: hex.get(x.tx_hash) })),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    // Upstream trouble: answer a clean empty list (never a 502), cached briefly so a burst of loads doesn't
    // hammer WOC. `x-coins-upstream: failed` lets the gun know the list is unknown, not empty, and ask WOC itself.
    return Response.json([], { headers: { 'cache-control': 'public, max-age=0, s-maxage=10', 'x-coins-upstream': 'failed' } });
  }
}
