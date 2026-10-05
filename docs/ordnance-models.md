# 1Sat Ordnance: weapon models

Each store weapon with its own model (`model` in `src/lib/ordnance.ts`). Downloaded from Sketchfab (download API),
optimised with gltf-transform (`optimize --compress meshopt --texture-compress webp --texture-size 1024`; BIG BLOCK at 512 + simplify)
into `public/arena/models/guns/`. Held and rendered by `buildGun` (`src/lib/arenaHD.ts`) via `gunDefFor` (`src/lib/ordnanceModels.ts`);
per-model fixes (flip, length, tint strength) are in `FIT` in `src/lib/ordnance.ts`. Changes made: recoloured with each weapon's finish.

The four stock models (minigun, plasmarifle, quadplasma, sawedoff) still carry Dust Sweeper, Laser-Eye Rifle, Mempool MiniGun and SAFU Blaster.

| File | Weapon id | Model | Author | Licence | Source | Size |
|---|---|---|---|---|---|---|
| `big-block.glb` | big-block | M125X Minigun | Bl4ckGh0st | CC BY 4.0 | https://sketchfab.com/3d-models/667cf95a5f924105b81db57de71a44a2 | 0.81 MB |
| `bitcoin-schema-sniper.glb` | bitcoin-schema-sniper | Sci fi Sniper Rifle | pasquill | CC BY 4.0 | https://sketchfab.com/3d-models/bf19b2ff1cf54f1a8038040c4aa5d913 | 0.37 MB |
| `block-reward.glb` | block-reward | Low-Poly M134 Minigun | TastyTony | CC BY 4.0 | https://sketchfab.com/3d-models/eed0c95de51b4895a48c5729582732cc | 0.29 MB |
| `craig-cannon.glb` | craig-cannon | Low-Poly KS-23 | TastyTony | CC BY 4.0 | https://sketchfab.com/3d-models/fa68ee59943340c5ac511350223290a0 | 0.08 MB |
| `double-spend.glb` | double-spend | Double Barrel Shotgun | Pepego | CC BY 4.0 | https://sketchfab.com/3d-models/04741a40f2224cffafc343b0236d5bbe | 0.48 MB |
| `fee-spike.glb` | fee-spike | Gatling Gun | Waseem963 | CC BY 4.0 | https://sketchfab.com/3d-models/f1ee47a632124c5d88493b5dfbb21967 | 0.23 MB |
| `genesis-blaster.glb` | genesis-blaster | Z-1V High-Voltage Pistol | valterjherson1 | CC BY 4.0 | https://sketchfab.com/3d-models/725d65cfd7b045f89ccf178127e16c05 | 0.36 MB |
| `hashpower-howitzer.glb` | hashpower-howitzer | Low-Poly RPG-7 | TastyTony | CC BY 4.0 | https://sketchfab.com/3d-models/5243ac034391491f9a47f797ea212afe | 0.04 MB |
| `kweg-grenade-launcher.glb` | kweg-grenade-launcher | Low-Poly Milkor MGL Mk 1s | TastyTony | CC BY 4.0 | https://sketchfab.com/3d-models/f62f582eada147b8aeb3c08773379d29 | 0.19 MB |
| `merkle-mauler.glb` | merkle-mauler | Low-Poly AAC Honey Badger | TastyTony | CC BY 4.0 | https://sketchfab.com/3d-models/cb2f959d048944c7bc5bde2f2be8bae4 | 0.27 MB |
| `nlocktime.glb` | nlocktime | Henry Lever-Action Rifle | Zverev | CC BY 4.0 | https://sketchfab.com/3d-models/98000c9642354a65b3203f76403128db | 0.69 MB |
| `op-return.glb` | op-return | Low-Poly IMI Uzi | TastyTony | CC BY 4.0 | https://sketchfab.com/3d-models/d9f0070b3c924caf8fe47e41881389f0 | 0.13 MB |
| `p2pkh-pistolero.glb` | p2pkh-pistolero | Revolver Navy Colt 1851 Silver | johanpindeville | CC BY 4.0 | https://sketchfab.com/3d-models/c254bb8ee01a4d9db9e6bbdc652d6c11 | 0.52 MB |
| `pnee-shotgun.glb` | pnee-shotgun | Model 1887 - Rusty Lever Action Shotgun | Ashe52 | CC BY 4.0 | https://sketchfab.com/3d-models/ca1a747f27cd4a4080098d6823105b7f | 0.28 MB |
| `sat-stacker.glb` | sat-stacker | Low-Poly M4a1 | TastyTony | CC BY 4.0 | https://sketchfab.com/3d-models/8cab1cbeb82c4396a154f9fc8771417b | 0.22 MB |
| `satoshi-sidearm.glb` | satoshi-sidearm | Victorian Revolver "Skytear" / (Free Lowpoly) | alcorerain | CC BY 4.0 | https://sketchfab.com/3d-models/c1340d6fc32842898a3c0bf3061cf043 | 0.16 MB |
| `teranode-cannon.glb` | teranode-cannon | Sci-fi rifle M13-Gaus | irons | CC BY 4.0 | https://sketchfab.com/3d-models/648847589fec4ecc9b91d7cdcc9c4d84 | 0.53 MB |
| `utxo-thumper.glb` | utxo-thumper | Low-Poly SPAS-12 | TastyTony | CC BY 4.0 | https://sketchfab.com/3d-models/c95154ea2348443e9195250a6ad122cb | 0.05 MB |
