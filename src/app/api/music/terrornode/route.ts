/**
 * The WELCOME TO TERRORNODE track list with short-lived signed stream URLs (src/lib/albumSign.ts), for the page's one
 * music player (src/lib/sfx.ts). Titles and order are bMusicX's (src/lib/terrornodeAlbum.ts).
 */
import { NextResponse } from 'next/server';
import { ALBUM, ALBUM_TRACKS } from '@/lib/terrornodeAlbum';
import { TTL_SECS, signedAlbumUrl } from '@/lib/albumSign';

export const dynamic = 'force-dynamic';

export async function GET() {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECS;
  return NextResponse.json(
    { album: ALBUM.title, artist: ALBUM.artist, exp, tracks: ALBUM_TRACKS.map((t) => ({ n: t.n, title: t.title, url: signedAlbumUrl(t.n, exp) })) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
