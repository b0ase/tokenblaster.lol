import { ammoFor } from '@/lib/ammo';
import { ORDNANCE, ORDNANCE_APP, ORDNANCE_COLLECTION, ORDNANCE_COLLECTION_NAME, modelUrl, priceOf } from '@/lib/ordnance';

const SITE = 'https://www.tokenblaster.lol';
// Stock gun models (GUNS in arenaHD.ts) that are modelled barrel-first, and the one with a spin clip.
const STOCK_FLIP = new Set(['minigun']);
const STOCK_SPIN: Record<string, string> = { minigun: 'Minigun_Rig|Rotation' };

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
        model: modelUrl(o),
        modelBase: o.model ?? o.base,
        tint: o.tint ?? null,
        // How we display it (same as the store and games): blend `tint` into the materials by
        // tintAmount, turn the model 180° about Y if `flip`, roll it about its long axis by `roll`
        // radians, and loop the `spin` animation clip if there is one.
        tintAmount: o.fit?.tint ?? (o.model ? 0.22 : 0.65),
        flip: o.model ? (o.fit?.flip ?? false) : STOCK_FLIP.has(o.base),
        roll: o.fit?.roll ?? 0,
        spin: o.model ? null : (STOCK_SPIN[o.base] ?? null),
        bolt: o.stats.bolt,
        // What it fires in LIVE play: kind + the BSV-21 ammo token (null until minted; PNEE matches by ticker).
        ammo: ammoFor(o.id),
        image: o.image ? `${SITE}${o.image}` : null,
        origin: o.origin || null,
      })),
    },
    { headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' } },
  );
}
