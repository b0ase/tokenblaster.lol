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
  background_color: '#0b0b0d',
  theme_color: '#0b0b0d',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
  metanet: {
    groupPermissions: {
      description: 'TokenBlaster turns the tokens in your wallet into ammo. You choose which token and how much; every bullet is a real transaction.',
      basketAccess: [
        {
          basket: 'bsv21',
          description: 'See the tokens in your wallet, so you can pick one to load as ammunition',
        },
      ],
      spendingAuthorization: {
        amount: 1_000_000,
        description: 'Spend up to 0.01 BSV a month on network fees, to load your gun and fire shots, without asking each time',
      },
    },
  },
};

export function GET() {
  return Response.json(manifest, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' } });
}
