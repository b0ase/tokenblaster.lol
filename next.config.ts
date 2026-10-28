import type { NextConfig } from 'next';

// Dev-only switches (src/lib/devFlags.ts) must never ship: refuse a Vercel build with either set.
if (process.env.VERCEL && (process.env.NEXT_PUBLIC_TB_CAPTURE === '1' || process.env.NEXT_PUBLIC_GALLERY_PAID === '0')) {
  throw new Error('NEXT_PUBLIC_TB_CAPTURE / NEXT_PUBLIC_GALLERY_PAID=0 are dev-only and must not be set on Vercel.');
}

const nextConfig: NextConfig = {
  // next/image: AVIF first (smallest), WebP fallback. The home page's arcade art and hero posters are 1200-1920px JPGs.
  // Ready-made token share cards read at request time by /launch/[id]/opengraph-image (TOKEN_PAGE_RULES.ogImage).
  outputFileTracingIncludes: { '/launch/[id]/opengraph-image': ['./src/assets/og/**'], '/launch/[id]/twitter-image': ['./src/assets/og/**'] },
  images: { formats: ['image/avif', 'image/webp'], qualities: [75, 80] },
  // bWalletX opens bGames inside its own frame: the web and desktop wallets, and capacitor://localhost on iOS.
  // Allow exactly those, plus ourselves (owner-approved 15 Oct 2026). Android (https://localhost) opens games
  // full-screen instead. No X-Frame-Options: it can't list origins.
  async headers() {
    return [
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://web.bwalletx.com https://desktop.bwalletx.com capacitor://localhost" }] },
      // TERRORNODE in the bChatX room's floating player (?embed=1, owner 27 Oct 2026): that route only, also framable by
      // bchatx.com. Listed after the catch-all so this value wins (Next: the last matching header with the same key).
      {
        source: '/arcade/terrornode',
        has: [{ type: 'query', key: 'embed', value: '1' }],
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://web.bwalletx.com https://desktop.bwalletx.com capacitor://localhost https://www.bchatx.com https://bchatx.com" }],
      },
      // 1Sat Ordnance models and art, loadable by wallets' 3D display cabinets (bWalletX).
      { source: '/arena/models/guns/:file*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
      { source: '/ordnance/:file*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
      // bWalletX site theme (+ the Assault sub-theme proposal) and its images: the wallet fetches them cross-origin.
      { source: '/.well-known/:file(bwalletx-theme.*)', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }, { key: 'Content-Type', value: 'application/json' }] },
      { source: '/brand/:file*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
      // BlastPad's API for wallets (bWalletX's Market lists and trades the coins). No cookies or sessions:
      // every trade is checked by wallet signatures and the client's own quote, so any origin may call it.
      {
        source: '/api/launch/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // ESCAPE FROM TERRORNODE lives at /arcade/terrornode (the on-chain game tag stays "gallery"); old links and shares keep working.
      // Uppercase /arcade/TERRORNODE is redirected in src/proxy.ts: redirect sources here match case-insensitively and would loop.
      ...['/arcade/assault', '/arcade/gallery'].flatMap((from) => [
        { source: `${from}/:path*`, destination: '/arcade/terrornode/:path*', permanent: true },
        { source: from, destination: '/arcade/terrornode', permanent: true },
      ]),
      { source: '/arcade/doubleo', destination: '/arcade/doubleosatoshi', permanent: true },
      { source: '/arcade/doubleokweg', destination: '/arcade/doubleosatoshi', permanent: true },
    ];
  },
};

export default nextConfig;
