/**
 * GET /api/coins?address=1… → the address's spendable sats coins with each parent tx's hex:
 * [{ txid, vout, sats, hex }]. Server-side because WhatsOnChain rate-limits browsers (503), and
 * GorillaPool's index can lag on mempool spends (it would hand back coins that are already spent).
 */
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';

async function woc(path: string, text = false): Promise<unknown> {
  for (let i = 0; ; i++) {
    const r = await fetch(`${WOC}${path}`, { cache: 'no-store' });
    if (r.ok) return text ? r.text() : r.json();
    if (i >= 4) throw new Error(`WOC ${r.status}`);
    await new Promise((ok) => setTimeout(ok, 700 * (i + 1)));
  }
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^1[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return Response.json({ error: 'bad address' }, { status: 400 });
  try {
    type U = { tx_hash: string; tx_pos: number; value: number; isSpentInMempoolTx?: boolean };
    const [c, u] = (await Promise.all([woc(`/address/${address}/confirmed/unspent`), woc(`/address/${address}/unconfirmed/unspent`)])) as { result?: U[] }[];
    // 1-sat outputs hold tokens: never treat them as sats.
    const list = [...(c.result ?? []), ...(u.result ?? [])].filter((x) => !x.isSpentInMempoolTx && x.value > 1).slice(0, 200);
    const hex = new Map<string, string>();
    for (const x of list) if (!hex.has(x.tx_hash)) hex.set(x.tx_hash, (await woc(`/tx/${x.tx_hash}/hex`, true)) as string);
    return Response.json(
      list.map((x) => ({ txid: x.tx_hash, vout: x.tx_pos, sats: x.value, hex: hex.get(x.tx_hash) })),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
