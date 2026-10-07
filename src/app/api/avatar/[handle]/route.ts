/**
 * GET /api/avatar/<xhandle> → the X profile picture (via unavatar.io, no key), proxied same-origin so games can use it
 * as a WebGL texture without CORS trouble. Strict handle check, 256 KB cap, image types only; anything else returns
 * a generated identicon (always 200 with an image, so <img> and textures never break). Cached at the edge for a day.
 */
import { HANDLE_RE, identiconSvg } from '@/lib/identity';

const MAX = 256 * 1024;
const OK_TYPES = /^image\/(jpeg|png|webp|gif)$/;
const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

const identicon = (h: string, status = 200) =>
  new Response(identiconSvg(h), { status, headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': CACHE, 'X-Content-Type-Options': 'nosniff' } });

export async function GET(_req: Request, ctx: RouteContext<'/api/avatar/[handle]'>) {
  const { handle } = await ctx.params;
  if (!HANDLE_RE.test(handle)) return identicon('anon', 400);
  try {
    const r = await fetch(`https://unavatar.io/x/${handle.toLowerCase()}?fallback=false`, { signal: AbortSignal.timeout(5000), redirect: 'follow' });
    const type = (r.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!r.ok || !OK_TYPES.test(type) || Number(r.headers.get('content-length') ?? 0) > MAX) return identicon(handle);
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX || buf.byteLength === 0) return identicon(handle);
    return new Response(buf, { headers: { 'Content-Type': type, 'Cache-Control': CACHE, 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return identicon(handle);
  }
}
