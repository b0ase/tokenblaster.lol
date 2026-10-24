/**
 * GET /api/gallery/board?window=event|24h → { window, since, prize, rows: [{ handle, shots, sessions }] }
 * Top Shooting Gallery players by accepted shots. Only LIVE sessions whose last txid was checked on chain
 * (ARC / WhatsOnChain: tokenblaster.lol tag, "gallery" game push, the player's handle) are counted.
 */
import { aggregateBoard, PRIZE } from '@/lib/gallery';
import { scoresSince } from '@/lib/scores';

export async function GET(request: Request) {
  const w = new URL(request.url).searchParams.get('window') === '24h' ? '24h' : 'event';
  const since = w === 'event' ? PRIZE.start : new Date(Date.now() - 24 * 3600_000).toISOString();
  try {
    const rows = (await scoresSince('gallery', since, 500)).filter((r) => r.mode === 'live' && r.verified && (w !== 'event' || Date.parse(r.created_at) < Date.parse(PRIZE.end)));
    return Response.json(
      { window: w, since, end: PRIZE.end, rows: aggregateBoard(rows).slice(0, 25) },
      { headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' } },
    );
  } catch {
    return Response.json({ window: w, since, rows: [], error: 'Board unavailable' }, { status: 502 });
  }
}
