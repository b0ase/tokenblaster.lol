import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // bWallet opens bApps (and bGames' chain games) inside its own frame: capacitor://localhost on iOS,
  // https://localhost on Android. Allow exactly those, plus ourselves.
  async headers() {
    return [
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' capacitor://localhost https://localhost https://web.bwalletx.com http://localhost:5190" }] },
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
      { source: '/arcade/doubleo', destination: '/arcade/doubleosatoshi', permanent: true },
      { source: '/arcade/doubleokweg', destination: '/arcade/doubleosatoshi', permanent: true },
    ];
  },
};

export default nextConfig;
