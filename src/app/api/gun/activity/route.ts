/**
 * GET /api/gun/activity?address=1… → { txs, more, last } : how many transactions a game-credit key has been in
 * (the load, the ammo split and every shot), from WhatsOnChain's public history. The recovery page uses it so a
 * player can see where their credit went (src/app/arcade/gun-recovery). Read only; no key, no wallet.
 */
import { NONE, woc } from '@/lib/wocServer';

type H = { result?: { tx_hash: string; height?: number }[]; nextPageToken?: string };

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^1[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return Response.json({ error: 'bad address' }, { status: 400 });
  try {
    const [c, u] = (await Promise.all([woc(`/address/${address}/confirmed/history?limit=1000`), woc(`/address/${address}/unconfirmed/history`)])).map((x) =>
      x === NONE || !x || typeof x !== 'object' ? {} : x,
    ) as H[];
    const conf = c.result ?? [];
    const unconf = u.result ?? [];
    // WOC lists confirmed history newest first; anything unconfirmed is newer still.
    const top = unconf[0] ?? conf[0];
    return Response.json(
      { txs: conf.length + unconf.length, more: Boolean(c.nextPageToken), last: top ? { txid: top.tx_hash, height: top.height ?? null } : null },
      { headers: { 'cache-control': 'public, s-maxage=30' } },
    );
  } catch {
    return Response.json({ error: 'history unavailable' }, { status: 502 });
  }
}
