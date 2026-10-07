# BSVGun range: asset credits

The range adds no new downloadable assets. Everything is either reused from files already in the site or generated in code.

- **Concrete / metal PBR textures**: `public/doubleo/tex/*` (concrete_floor_02, concrete_wall_006, metal_plate_02), CC0 (public domain) from Poly Haven (polyhaven.com). Credited in `public/doubleo/CREDITS.md`.
- **Weapon models**: the four stock guns and the 1Sat Ordnance guns in `public/arena/models/guns/*`, credited in `public/arena/CREDITS.md` and `docs/ordnance-models.md`.
- **Procedural (original, no files)**: the sky dome (gradient, clouds, stars, moon), the image-based-lighting environment (neon strip lights, baked with PMREM at load), every target body (clay pigeon, token coin, ordinal gem, duck, pop-up plate, golden whale, block), shards, sparks, tracers, the sign, skyline and distance boards (canvas textures), and all sound effects (Web Audio, `src/lib/sfx.ts`).
- **Token logos** on the coins are fetched live from the chain's token index (the token's own on-chain icon).
- **Type**: Barlow Condensed, Space Mono and Noto Sans JP via `next/font` (SIL OFL 1.1).
- **Graphic language**: the in-house DR system (`src/lib/dr`, `src/components/dr`); an homage, all layouts original.
