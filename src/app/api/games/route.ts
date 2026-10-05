import { isPeriod } from '@/lib/leaderboard';

/** GET /api/games?period=24h|7d|30d|all → { period, games: [{ game, blasts }] }: blasts per arcade game. */
const HOURS = { '24h': 24, '7d': 168, '30d': 720, all: null } as const;

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams.get('period');
  const period = isPeriod(p) ? p : '24h';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ period, error: 'not configured' }, { status: 502 });
  const hours = HOURS[period];
  const since = hours ? new Date(Date.now() - hours * 3600_000).toISOString() : null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/tokenblaster_games`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ since }),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(String(r.status));
    const games = ((await r.json()) as { game: string; blasts: number }[]).map((g) => ({ game: g.game, blasts: Number(g.blasts) }));
    return Response.json({ period, games }, { headers: { 'cache-control': 'public, s-maxage=30' } });
  } catch {
    return Response.json({ period, error: 'Game stats unavailable' }, { status: 502 });
  }
}
