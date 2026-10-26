/**
 * TERRORNODE TEAM MODE matches, for the lobby and the bChatX TERRORNODE room (proxied to the game server,
 * server/terrornode-team, at TERRORNODE_TEAM_URL; default http://localhost:8787 in dev).
 *   POST { mode: 'coop'|'pvp', level?, tournamentId? } → { code, id, mode, level, inviteUrl }   (bChatX makes a match + invite link)
 *        level: assault | market | rails | datacore | heart (src/lib/terrornode/levels.ts), default assault
 *   GET  ?tournament=<id>                         → { matches: PublicState[] }
 */
import { NextResponse } from 'next/server';
import { TEAM_HTTP } from '@/lib/teammode/server';
import { isLevelId } from '@/lib/terrornode/levels';

export const dynamic = 'force-dynamic';
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get('tournament');
  try {
    const r = await fetch(`${TEAM_HTTP}/matches${t ? `?tournament=${encodeURIComponent(t)}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return NextResponse.json(await r.json(), { status: r.status, headers: CORS });
  } catch {
    return NextResponse.json({ error: 'The team server is offline.', matches: [] }, { status: 503, headers: CORS });
  }
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { mode?: string; level?: string; tournamentId?: string };
  try {
    const r = await fetch(`${TEAM_HTTP}/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: b.mode === 'pvp' ? 'pvp' : 'coop', level: isLevelId(b.level) ? b.level : 'assault', tournamentId: typeof b.tournamentId === 'string' ? b.tournamentId : null }),
      signal: AbortSignal.timeout(4000),
    });
    return NextResponse.json(await r.json(), { status: r.status, headers: CORS });
  } catch {
    return NextResponse.json({ error: 'The team server is offline.' }, { status: 503, headers: CORS });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' } });
}
