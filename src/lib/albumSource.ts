/**
 * Where the TERRORNODE album audio comes from (server-only).
 *  - TB_ALBUM_SOURCE=blob: full tracks from the PRIVATE Vercel Blob store (needs BLOB_READ_WRITE_TOKEN). Private blobs
 *    have no public URL; reads need the token, which never leaves the server.
 *  - otherwise: bMusicX's public 45 s samples under TB_ALBUM_AUDIO_BASE (default https://bmusicx.com/bmx/samples).
 */
import type { AlbumTrack } from './terrornodeAlbum';

export type AlbumSource = { kind: 'blob'; pathname: string } | { kind: 'url'; url: string };

export function albumSource(track: AlbumTrack, env: Record<string, string | undefined> = process.env): AlbumSource {
  if (env.TB_ALBUM_SOURCE === 'blob' && env.BLOB_READ_WRITE_TOKEN) {
    return { kind: 'blob', pathname: `terrornode-album/${track.master}` };
  }
  const base = (env.TB_ALBUM_AUDIO_BASE || 'https://bmusicx.com/bmx/samples').replace(/\/$/, '');
  return { kind: 'url', url: `${base}/${track.file}` };
}
