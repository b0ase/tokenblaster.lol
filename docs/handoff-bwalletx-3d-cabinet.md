# Handoff to the bWalletX agent: a 3D display cabinet for 1Sat Ordnance (and other 3D NFTs)

From: the tokenblaster.lol session, 2026-10-05. For: whoever works on the bWalletX wallet app.

## What exists now

tokenblaster.lol sells game weapons as real 1Sat ordinals: **1Sat Ordnance**, 22 guns, store at
https://www.tokenblaster.lol/1satordnance/store. The buyer's own wallet makes ONE transaction:

- output 0: the inscription (1 sat, P2PKH to a wallet-derived key), content = the gun's square art
  (`image/webp`), MAP metadata after OP_RETURN;
- output 1: the price, paid to the TokenBlaster house address.

Holding one unlocks the gun in Double-O Kweg and the Arena. Today any wallet shows only the flat
art. We'd like bWalletX to show these (and later any 3D NFT) as spinning 3D models in a
"display cabinet".

## Recognising an Ordnance inscription

MAP fields on the inscription (origin):

| key | value |
|---|---|
| `app` | `tokenblaster.lol` |
| `type` | `ord` |
| `subType` | `collectionItem` |
| `collection` | `1Sat Ordnance` |
| `weapon` | weapon id, e.g. `big-block` |
| `name` | `BIG BLOCK #3` |
| `model` | glTF URL, e.g. `https://www.tokenblaster.lol/arena/models/guns/minigun.glb` |
| `tint` | finish colour, e.g. `#ffd24d` (may be empty) |
| `subTypeData` | JSON: description, mintNumber, rarityLabel, traits |

The 5 original guns were designed before `model`/`tint` were added; look those up by `weapon` in the
manifest below instead of trusting the MAP alone.

## Endpoints (CORS open)

- **Catalogue:** `GET https://www.tokenblaster.lol/api/ordnance/manifest`
  → `{ app, collection, verify, weapons: [{ id, name, rarity, tagline, description, edition, priceSats, model, modelBase, tint, bolt, image, origin }] }`
- **Genuine issues:** `GET https://www.tokenblaster.lol/api/ordnance/issued`
  → `{ issued: { [weaponId]: originOutpoint[] } }`. Anyone can inscribe a look-alike with the same
  MAP; only origins listed here paid the house and are real. Badge unverified ones (or hide them).
- **Models:** `https://www.tokenblaster.lol/arena/models/guns/{minigun,plasmarifle,quadplasma,sawedoff}.glb`
  (meshopt-compressed glTF: use `GLTFLoader().setMeshoptDecoder(MeshoptDecoder)`).

## Rendering notes (learned the hard way)

1. **Tint** the model the way the games do (`src/lib/ordnanceGun.ts` in tokenblaster.lol): for every
   mesh material, clone it, `color.lerp(tint, 0.65–0.7)`, `metalness = max(metalness, 0.7)`,
   `emissive.lerp(tint, 0.12)`. Several guns share one base model; the tint is what makes them distinct.
2. **The minigun is rigged (skinned).** Clone it with `SkeletonUtils.clone`, not `object.clone()`, or
   the copy keeps following the original's bones and ignores your transforms. It is modelled
   barrel-first: rotate it `y += π/2` to show it side-on. It has a barrel-spin clip
   `Minigun_Rig|Rotation` that looks great looping in a cabinet.
3. Lighting that works: `RoomEnvironment` via PMREM as `scene.environment`, ACES tone mapping,
   sRGB output, a rim light in the rarity colour (common `#c9b37a`, rare `#6ae0ff`, epic `#c070ff`,
   legendary `#ffd700`).
4. Reference renderer: `src/lib/ordnanceArt.ts` in tokenblaster.lol (framing, backdrop, all of the above).

## Suggested cabinet

- A "3D" tab/section in the collectibles view. For each ordinal: if MAP `app=tokenblaster.lol` and
  `weapon` is in the manifest → 3D card (orbit/spin, rarity glow, "Verified" if in `issued`), with a
  link to `https://www.tokenblaster.lol/1satordnance/store#<weapon>`; else fall back to the flat image.
- Generic 3D NFTs later: treat an inscription as 3D if its content type is `model/gltf-binary` /
  `model/gltf+json`, or its MAP has a `model` URL. Ordnance is the first customer of that rule.
- Load models lazily (only cards in view) and dispose renderers/geometries when cards unmount;
  phones run out of WebGL contexts fast. One shared renderer drawing into each card is safest.

## Open questions for the owner

- Should the cabinet show unverified look-alikes at all?
- Fully on-chain 3D (inscribing the `.glb` itself) would remove the dependency on tokenblaster.lol
  being up. Not done; it would cost more in fees per gun.
