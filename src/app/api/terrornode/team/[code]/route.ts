/**
 * Public match state for the bChatX TERRORNODE room to poll (every 2-5 s is plenty): match + tournament id, mode,
 * phase, teams (NPG / Erobotz) with frags and score, players (name, team, score, kills, alive) and each player's
 * GO LIVE stream slot. Proxied from the game server's GET /matches/:code.
 */
import { NextResponse } from 'next/server';
import { TEAM_HTTP } from '@/lib/teammode/server';

export const dynamic = 'force-dynamic';
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!/^[A-Za-z0-9]{5}$/.test(code)) return NextResponse.json({ error: 'Bad match code.' }, { status: 400, headers: CORS });
  try {
    const r = await fetch(`${TEAM_HTTP}/matches/${code.toUpperCase()}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return NextResponse.json(await r.json(), { status: r.status, headers: CORS });
  } catch {
    return NextResponse.json({ error: 'The team server is offline.' }, { status: 503, headers: CORS });
  }
}
