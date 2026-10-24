/**
 * /manifest.json: what BRC-100 wallets (Yours v5, bWallet, bWalletX, Metanet) read to ask for all of
 * this site's permissions in ONE plain-English prompt (BRC-73 grouped permissions), instead of a
 * popup per wallet call. After that, loading ammo is a single "load N $TOKEN?" approval.
 */
export const dynamic = 'force-static';

const manifest = {
  name: 'TokenBlaster.lol',
  short_name: 'TokenBlaster',
  start_url: '/arena',
  display: 'standalone',
  background_color: '#0a0404',
  theme_color: '#0a0404',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
  metanet: {
    groupPermissions: {
      description: 'TokenBlaster: coin-op arcade games and guns. You choose how much to put in, and your wallet asks you to approve that exact amount each time. Every coin and bullet is a real transaction.',
      basketAccess: [
        {
          basket: 'bsv21',
          description: 'See the tokens in your wallet, so you can pick one to load as ammunition',
        },
      ],
      // No standing spending allowance (owner, 24 Oct 2026): each LOCK & LOAD / START asks the wallet once, for the exact
      // amount the player put in. A monthly allowance read as "spend 15M sats" before anything was chosen.
    },
  },
};

export function GET() {
  return Response.json(manifest, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' } });
}
