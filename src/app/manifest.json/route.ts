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
      description: 'TokenBlaster: 10p-a-go arcade games, and guns that fire the tokens in your wallet. You choose what to play and what to load; every coin and bullet is a real transaction.',
      basketAccess: [
        {
          basket: 'bsv21',
          description: 'See the tokens in your wallet, so you can pick one to load as ammunition',
        },
      ],
      // One 10p arcade coin is ~690,000 sats at £14.5/BSV, so the old 0.01 BSV/month ran out after one coin
      // and every later coin prompted again. 0.15 BSV (about £2 a month) covers ~20 games plus fees.
      spendingAuthorization: {
        amount: 15_000_000,
        description: 'Spend up to 0.15 BSV a month (about £2) without asking each time: 10p arcade coins, loading your gun and shot fees. You still press PLAY for every coin.',
      },
    },
  },
};

export function GET() {
  return Response.json(manifest, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' } });
}
