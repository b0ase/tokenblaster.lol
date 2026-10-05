import { ORDNANCE, ORDNANCE_APP, ORDNANCE_COLLECTION, ORDNANCE_COLLECTION_NAME, priceOf } from '@/lib/ordnance';

const SITE = 'https://www.tokenblaster.lol';

/**
 * GET /api/ordnance/manifest: public catalogue for wallets and 3D display cabinets (bWalletX).
 * Match an inscription by MAP app + weapon (or origin), then show `model` with `tint`.
 */
export function GET() {
  return Response.json(
    {
      app: ORDNANCE_APP,
      collection: { name: ORDNANCE_COLLECTION_NAME, origin: ORDNANCE_COLLECTION || null },
      verify: `${SITE}/api/ordnance/issued`,
      weapons: ORDNANCE.map((o) => ({
        id: o.id,
        name: o.name,
        rarity: o.rarity,
        tagline: o.tagline,
        description: o.description,
        edition: o.edition,
        priceSats: priceOf(o),
        model: `${SITE}/arena/models/guns/${o.base}.glb`,
        modelBase: o.base,
        tint: o.tint ?? null,
        bolt: o.stats.bolt,
        image: o.image ? `${SITE}${o.image}` : null,
        origin: o.origin || null,
      })),
    },
    { headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' } },
  );
}
