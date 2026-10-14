import { GAMES } from '@/lib/games';

/**
 * GET /api/public/games?cursor= → { items, next }: the arcade as a public, no-auth feed for bWalletX's bGames tab.
 * `plays` is all-time blasts on chain (games without LIVE blasting have none). `cursor` is an offset; `next` is null at the end.
 */
const ORIGIN = 'https://www.tokenblaster.lol';
const ALLOWED = new Set(['https://web.bwalletx.com', 'https://desktop.bwalletx.com']);
const PAGE = 50;

function cors(request: Request): Record<string, string> {
  const o = request.headers.get('origin');
  return o && ALLOWED.has(o) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : { Vary: 'Origin' };
}

async function blasts(): Promise<Record<string, number>> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return {};
  try {
    const r = await fetch(`${url}/rest/v1/rpc/tokenblaster_games`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: null }),
      next: { revalidate: 60 },
    });
    if (!r.ok) return {};
    return Object.fromEntries(((await r.json()) as { game: string; blasts: number }[]).map((g) => [g.game, Number(g.blasts)]));
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const cursor = Math.max(0, Number(new URL(request.url).searchParams.get('cursor')) || 0);
  const counts = await blasts();
  const live = GAMES.filter((g) => g.status === 'live' && g.href);
  const items = live.slice(cursor, cursor + PAGE).map((g) => {
    const url = new URL(g.href!, ORIGIN).toString();
    return {
      id: `tokenblaster:${url.slice(ORIGIN.length + 1) || 'home'}`,
      title: g.title,
      url,
      icon: `${ORIGIN}/apple-icon.png`,
      poster: new URL(g.img, ORIGIN).toString(),
      preview: null,
      creator: 'tokenblaster',
      token: null,
      category: g.kind ?? 'game',
      blurb: g.blurb,
      createdAt: null,
      likes: null,
      plays: g.tag ? counts[g.tag] ?? 0 : null,
      source: 'tokenblaster.lol',
    };
  });
  const next = cursor + PAGE < live.length ? String(cursor + PAGE) : null;
  return Response.json({ items, next }, { headers: { ...cors(request), 'cache-control': 'public, s-maxage=60' } });
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: { ...cors(request), 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' } });
}
