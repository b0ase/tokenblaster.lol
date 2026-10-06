import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // bWallet opens bApps (and bGames' chain games) inside its own frame: capacitor://localhost on iOS,
  // https://localhost on Android. Allow exactly those, plus ourselves.
  async headers() {
    return [
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' capacitor://localhost https://localhost" }] },
      // 1Sat Ordnance models and art, loadable by wallets' 3D display cabinets (bWalletX).
      { source: '/arena/models/guns/:file*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
      { source: '/ordnance/:file*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
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
