/**
 * Streams one WELCOME TO TERRORNODE track to the page's audio player, through this origin, from bMusicX's audio
 * (TB_ALBUM_AUDIO_BASE, default https://bmusicx.com/bmx/samples: what bmusicx.com/album/welcome-to-terrornode
 * plays today). Range requests pass through so the player can seek and buffer.
 *
 * What this does against downloading (and what it does not; owner asked for the honest version, 31 Oct 2026):
 *  - the upstream file path never reaches the browser; URLs are signed and expire (src/lib/albumSign.ts);
 *  - only media-element requests from this site are served: opening the URL in a tab, a download link, curl without
 *    the browser's fetch-metadata headers, or another site embedding it gets 403;
 *  - responses are `no-store` and `inline`, so there is no "save as" filename and no shared-cache copy.
 * It is not DRM. Anyone can still record the tab's audio output (OS / browser recorders, a loopback device), copy a
 * signed URL out of dev tools and replay it with forged headers inside its two-hour life, or read the decoded audio
 * from the page with a script. Only per-segment encryption with paid keys (bMusicX's /api/bmusic/stream) raises
 * that bar, and even then the decoded sound can be recorded.
 */
import { ALBUM_TRACKS } from '@/lib/terrornodeAlbum';
import { verifyAlbumSig } from '@/lib/albumSign';

export const dynamic = 'force-dynamic';

const BASE = (process.env.TB_ALBUM_AUDIO_BASE || 'https://bmusicx.com/bmx/samples').replace(/\/$/, '');
const deny = (why: string, status = 403) => new Response(why, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const { n: raw } = await ctx.params;
  const n = Number(raw);
  const track = ALBUM_TRACKS.find((t) => t.n === n);
  if (!track) return deny('No such track.', 404);
  const q = new URL(req.url).searchParams;
  if (!verifyAlbumSig(n, q.get('e'), q.get('s'))) return deny('This link has expired.');
  // Fetch metadata (every current browser sends it): a media element on this site, nothing else.
  const site = req.headers.get('sec-fetch-site');
  const dest = req.headers.get('sec-fetch-dest');
  if (site !== 'same-origin' || (dest !== 'audio' && dest !== 'video' && dest !== 'empty')) return deny('Plays on tokenblaster.lol only.');

  const range = req.headers.get('range');
  let up: Response;
  try {
    up = await fetch(`${BASE}/${track.file}`, { headers: range ? { range } : {}, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return deny('Music service unavailable.', 502);
  }
  if (!up.ok && up.status !== 206) return deny('Music service unavailable.', 502);
  const h = new Headers({
    'content-type': up.headers.get('content-type') ?? 'audio/mp4',
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
    'content-disposition': 'inline',
    'x-content-type-options': 'nosniff',
  });
  for (const k of ['content-length', 'content-range']) {
    const v = up.headers.get(k);
    if (v) h.set(k, v);
  }
  return new Response(up.body, { status: up.status, headers: h });
}
