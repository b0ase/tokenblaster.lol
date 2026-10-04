import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // bWallet opens bApps (and bGames' chain games) inside its own frame: capacitor://localhost on iOS,
  // https://localhost on Android. Allow exactly those, plus ourselves.
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' capacitor://localhost https://localhost" }] }];
  },
};

export default nextConfig;
