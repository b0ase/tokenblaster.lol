import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // next/image: AVIF first (smallest), WebP fallback. The home page's arcade art and hero posters are 1200-1920px JPGs.
  images: { formats: ['image/avif', 'image/webp'], qualities: [75, 80] },
  // bWalletX opens bGames inside its own frame: the web and desktop wallets, and capacitor://localhost on iOS.
  // Allow exactly those, plus ourselves (owner-approved 15 Oct 2026). Android (https://localhost) opens games
  // full-screen instead. No X-Frame-Options: it can't list origins.
  async headers() {
    return [
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://web.bwalletx.com https://desktop.bwalletx.com capacitor://localhost" }] },
      // 1Sat Ordnance models and art, loadable by wallets' 3D display cabinets (bWalletX).
      { source: '/arena/models/guns/:file*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
      { source: '/ordnance/:file*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
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
      // ASSAULT ON TERRORNODE lives at /arcade/assault (the on-chain game tag stays "gallery"); old links and shares keep working.
      { source: '/arcade/gallery/:path*', destination: '/arcade/assault/:path*', permanent: true },
      { source: '/arcade/gallery', destination: '/arcade/assault', permanent: true },
      { source: '/arcade/doubleo', destination: '/arcade/doubleosatoshi', permanent: true },
      { source: '/arcade/doubleokweg', destination: '/arcade/doubleosatoshi', permanent: true },
    ];
  },
};

export default nextConfig;
