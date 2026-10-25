import { NextResponse, type NextRequest } from 'next/server';

// The game's real route is lowercase /arcade/terrornode. Any other casing (e.g. /arcade/TERRORNODE, from posters and
// shares) 308s to it. This lives here, not in next.config redirects, because those match case-insensitively and loop.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const m = /^\/arcade\/(terrornode)(\/.*)?$/i.exec(pathname);
  if (!m || m[1] === 'terrornode') return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/arcade/terrornode${m[2] ?? ''}`;
  return NextResponse.redirect(url, 308);
}

export const config = { matcher: ['/arcade/:slug', '/arcade/:slug/:path*'] };
