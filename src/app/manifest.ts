import type { MetadataRoute } from 'next';

/** Installable on phones (Add to Home Screen) and listed in bWallet's Apps tab. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'TokenBlaster.lol',
    short_name: 'TokenBlaster',
    description: 'Load your token into the gun and blast it at the BSV chain. Live chain traffic from GorillaPool.',
    start_url: '/blast',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0b0d',
    theme_color: '#0b0b0d',
    categories: ['games', 'entertainment'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/tile.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
