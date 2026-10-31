/**
 * Short-lived signed URLs for the TERRORNODE album stream (server only). A URL is /api/music/terrornode/<n>?e=<exp>&s=<sig>
 * with sig = HMAC-SHA256(secret, "<n>.<exp>"), valid for TTL_SECS. This stops hotlinking and copy-pasted links that keep
 * working; it is not DRM (see src/app/api/music/terrornode/[n]/route.ts).
 *
 * Secret: TB_MUSIC_URL_SECRET (any long random string, set in Vercel). Without it a fixed dev value is used and the
 * signature is only a formality, so set it in production.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { albumStreamPath } from './terrornodeAlbum';

export const TTL_SECS = 2 * 60 * 60;
const secret = () => process.env.TB_MUSIC_URL_SECRET || 'tb-dev-music-url-secret';

const sig = (n: number, exp: number) => createHmac('sha256', secret()).update(`${n}.${exp}`).digest('base64url');

export function signedAlbumUrl(n: number, exp: number) {
  return `${albumStreamPath(n)}?e=${exp}&s=${sig(n, exp)}`;
}

export function verifyAlbumSig(n: number, e: string | null, s: string | null, nowSecs = Math.floor(Date.now() / 1000)) {
  const exp = Number(e);
  if (!Number.isInteger(exp) || exp < nowSecs || exp > nowSecs + TTL_SECS + 60 || !s) return false;
  const want = Buffer.from(sig(n, exp));
  const got = Buffer.from(s);
  return got.length === want.length && timingSafeEqual(got, want);
}
