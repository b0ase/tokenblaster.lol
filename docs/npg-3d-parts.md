# NPG 3D part cards

> **Read [npg-3d-lessons.md](npg-3d-lessons.md) first:** it covers what works, what doesn't, and the owner's rules.

Turning the Ninja Punk Girls 2D part cards into 3D parts that stack on one rigged chibi base,
the same way the 2D cards stack on a shared canvas. Status as of 2026-10-04.

## Where things are

| What | Where |
|---|---|
| Stack builder (fit parts onto the chibi) | `/viewer`, top panel. `src/components/StackBuilder.tsx` |
| Inspect a single model, side-by-side compare | `/viewer`, Inspect panel. `src/components/ModelViewer.tsx` |
| Models | `public/arena/models/npg/stack/*.glb` |
| Part list + saved fits | `public/arena/models/npg/stack/parts.json` |
| Source cards (PNG) | `ninja-punk-girls-com/public/assets/<NN>-<Category>/` |
| Chibi base | `chibi_base.glb` (from `ninja-punk-girls-com/public/3D_assets/chibi_cyberpunk_final.glb`) |

The chibi's own mask is the **Ayumi** design. Pick "Base mask (chibi) = Ayumi" in Inspect to compare against it.

## How a part gets placed

- Every part attaches to a bone: hair, horns and masks on `head`; weapons on the `item.L` / `item.R` sockets (children of the hand bones). Planned: boots on the feet, tops on the chest.
- **Right-weapon cards (07) draw the weapon in the character's LEFT hand** (viewer's right), so they go on `item.L`. Left-weapon cards (08) go on `item.R` (LEFT WEAPON row in the builder).
- The **slot** is a box on the base, expressed in the bone's space. Hair uses the base `hair` mesh. Masks use the base `mask` mesh. Horns use the top of the hair box.
- Tripo models often come out "lying along Z", with their width running front to back. Those get a quarter turn automatically.
- Some models (for example Glasses) come out lying on their back and need **pitch −90°**.

## Fit controls (per part)

| Control | What it does |
|---|---|
| size | scale |
| up/down, fwd/back | move the part |
| yaw | turn around the vertical axis (shake head) |
| pitch | tilt around the X axis (nod), ±180° |
| roll | tilt sideways, ±180° |
| bend | bend deformer: wraps a flat part round a cylinder. +0.5 is about right for glasses and flat masks. Don't use it on deep models, it wrecks them |
| copy JSON | copies that part's fit, e.g. `{"slot":"mask","card":"…","scale":1,"y":0,…}` |

Workflow: fit a part, copy JSON, and paste it to Claude. It's then saved as that card's default: hair in `HAIR` in StackBuilder.tsx, masks and horns in `parts.json` under `fit`.

Saved fits so far: Yamarashii hair, Yama mask, Miami Sunglasses, Glasses (pitch −90°, judged "good enough").

## Chosen method for rigid parts: hand-modelling (owner verdict 2026-10-08)

Tripo / TripoSR image-to-3D is **rejected** for rigid parts. Hand-built Blender models were judged "good enough" and are the method going forward.

- Scripts: `scripts/npg-handmodel/` (one script per part, plus `hm_common.py` helpers). Run one at a time: `Blender -b -P scripts/npg-handmodel/<part>.py` writes `public/arena/models/npg/stack/hand/<id>.glb`.
- Quality bar: clean stylised prop, bevels, crisp flat colours, ≤3k tris (Phi-Phi is 3.6k, kept as approved). Look at the card first, render card vs front / ¾ / side / back (`render_views.py` + `compare.py`), critique, iterate at least twice. **Precision gate:** `python3 silhouette_check.py part.glb card.png out_prefix [--tilt DEG]` renders the front mask at K and prints IoU vs the card alpha (+ thirds, diff PNG); target ≥ 0.90. Phi-Phi, Small Horns and Sai are now built straight off the card (`card_alpha`, `inflate`, ray-fit sweeps in `hm_common.py`).
- **One scale for every card.** The card canvas is the whole character, so a part's size on the chibi = card px × **K = 0.00107** (chibi model units per card px; calibrated on the chibi: Miyuki face card 287 px ↔ head 0.31, hair-top-to-boots ~850 px ↔ 0.897). `measure_card.py` prints a card's bbox / principal-axis size in metres.
- **Proportions match the card**: each script prints `MEASURE` (model front-view h/w vs the card's alpha bbox h/w); keep it within ~5%. Weapons are measured tilted to the card's angle (`fit_weapon`).
- Origins: head parts = the card's face centre (`place_to_card` puts them where the card draws them); weapons = the grip, blade/shaft along +Y (glTF), flats facing the camera.
- Stack Builder: `"handBuilt": true` parts are not auto-scaled. They're placed in the chibi's model space at the face anchor (head mesh centre, mask-centre height) or the socket, plus the fit, then re-expressed in the bone. Weapon default `roll` tilts the weapon to the card's angle. `check_on_chibi.py` renders the same placement in Blender (needs the uncompressed `chibi_cyberpunk_final.glb`).

| Part | Card h/w → model | Notes |
|---|---|---|
| Phi-Phi Horn (09_001) | 1.485 → 1.485 | upper bands + tip stretched (owner: "a bit short"). Worn as a helmet: sized to her head (fit scale 1.06, y 0.07, z −0.02) so the rim sits at the brow round the whole head, face visible; `"hidesHair": true` hides the hair under it |
| Scarlet Horns (09_002) | 0.389 → 0.390 | alice band + faceted horns + side spikes |
| Small Horns (09_003) | 0.288 → 0.275 | ram horns + inner claws; front reads a bit domed |
| Spikes (09_004) | 0.621 → 0.615 | heart forehead plate, default fit y 0.06 z 0.07 |
| Spiked Bat (07_026) | length 0.474 m, w/l 0.289 → 0.284 | barrel oval 0.75 depth (owner: "a bit flatter") |
| Red Axe (07_003) | 0.789 → 0.786 (at 19°) | |
| Katana (07_009) | 0.694 → 0.669 (at 28°) | |
| Sai (07_008) | 0.585 → 0.585 (at 30°) | |
| Hikaru Horns (23_002) | 0.400 → 0.391 | rear horns, pushed 7 cm behind the face; gold rivet collars |
| Big Red Horns (23_004) | 0.353 → 0.362 | rear horns; top roll-over reads a bit boxy |
| Black Axe (07_004) | 1.424 → 1.356 (at −65°, hangs head-down) | |
| Machete (07_020) | 0.638 → 0.612 (at 30°) | saw spine, vent holes |
| Graffiti Can (07_011) | 2.342 → 2.240 (upright) | label is a plain swirl blob, not the card logo |
| Guitar (07_037) | 0.918 → 0.895 (at 44°) | origin mid-neck |

**Texture pass (all hand-built parts):** after the build script, run
`Blender -b -P card_bake.py -- part.glb [1024] [rag_mm]`. It bakes one illustrated albedo atlas per part,
style chosen per material by name: `wood*` grain, metal names (`steel`, `edge`, `blade`, `iron`, `brass`…)
sheen bands + bright edge highlight, `tape`/`wrap`/`grip` matte, everything else "paint" (darker same-hue
rim, broken highlight streaks, chips). Ink on hard edges + AO crevices for all. `texture_bake.py` stays the
exact Phi-Phi recipe. Name materials so the right style is picked (Red Axe's pink strip is `rim`, not `edge`).

## How 2D NPGs assemble (ninja-punk-girls-com)

- **One canvas.** Every card is a 961×1441 transparent PNG drawn full-canvas at (0, 0), no offsets
  (`src/components/canvas/NFTCanvas.tsx`, mint page `aspect-[961/1441]`). A card's position, size and angle
  on the canvas *is* its placement on the body. Cards: `public/assets/<NN>-<Category>/NN_NNN_<Category>_<Name>.png` + `.json`
  (character, rarity, stats); ~650 PNGs across 27 categories.
- **Draw order, back to front:** 29 Background, 28 Glow, 27 Banner, 26 Decals, **24 Rear-Hair, 23 Rear-Horns, 22 Back**
  (behind the body), 21 Body, 20 Arms, 19 Underwear, 18 Face, 17 Shorts, 16 Bra, 15 Collar, 14 Jewellery, 13 Boots, 12 Top,
  11 Mask, 10 Hair, 09 Horns, **08 Left-Weapon, 07 Right-Weapon** (on top of everything), 06 Effects, 05 Interface,
  04 Team, 02 Copyright, 01 Logo. (03 and 25 don't exist.)
- **Hands:** 07 Right-Weapon cards are drawn on the viewer's right = the character's LEFT hand (`item.L`).
  08 Left-Weapon cards are drawn on the viewer's left = her RIGHT hand (`item.R`). Most 08 cards are the mirror
  image of the matching 07 card (flipped-alpha IoU 0.5–0.95), at the mirrored angle.
- **Slot machine** (`src/app/mint/SlotMachinePreloader.tsx`): one random card per layer from Background, Body, Arms,
  Underwear, Face, Bra, Boots, Top, Mask, Hair, Left-Weapon, Right-Weapon. Mints can hue-shift a layer
  (`metadata.rgbHue`, CSS `hue-rotate`), so recoloured horns/hair in a preview won't pixel-match their card.
- **Series 2 on chain:** 3,334 NPGs (`src/data/canonicalSlots.ts`, `canonicalSlotsData.json`). Their item names
  ("Kimiko Studded", "Weapon Graffitti") are an older naming and don't map 1:1 onto today's card files.
- **References:** 36 flattened composites in `public/slot-machine-previews/` (0021_Meya is corrupt). They are built
  from today's card files, so `compare_stack.py` recovers their part list by template matching (match ≥ 0.7, or the
  best partly covered Body/Face).
- **3D ↔ canvas:** 1 card px = K = 0.00107 chibi units, card face centre (484.5, 669.5) = the chibi face anchor. With an
  orthographic front camera framed to the canvas, the chibi overlays the 2D body almost exactly (head, shoulders, boots).

## Stack compare + card-derived fits

`scripts/npg-handmodel/compare_stack.py` (+ `compare_stack_bl.py`, Blender, one at a time):

- `python3 compare_stack.py --preview 0007` (or `--cards 07_009 08_005 10_011 …`): identifies the cards, composites the
  2D stack in the site's order, assembles the parts that exist in 3D on the chibi (hand-built, wrapped masks, Tripo masks,
  hair GLBs; 08 = mirrored 07), renders an ortho front view on the same canvas and writes
  `.private/handmodel/stack-compare/<npg>_side.png` (preview | 2D stack | 3D | 50% overlay), `_overlay.png`, and a JSON
  with the part list and what's missing in 3D.
- `python3 compare_stack.py --derive-fits [--write]`: projects every hand-built part at its fit, rasterises it on the card
  canvas and fits it to the card alpha. Weapons: roll about the grip + x/y shift (principal-axis angle tried both ways
  round, then an IoU search). Head parts: x/y from the bbox centre, only where no fit was saved by hand (Phi-Phi and
  Spikes keep the owner's fits). Weapon IoU vs card after fitting: Graffiti Can 0.94, Machete 0.80, Bat 0.63, Katana 0.60,
  Black Axe 0.57, Sai 0.54, Red Axe 0.42, Guitar 0.41 (the rest is shape, not placement).
- parts.json entries now carry `"card": "NN_NNN"`. Fits have an `x` (left/right) as well; the Stack Builder has a
  left/right slider.
- **Left weapon slot** (`"slot": "lweapon"`, socket `R`): the 8 built 07 pieces whose 08 card is the mirror design
  (Black Axe, Sai, Katana, Red Axe, Graffiti Can, Machete, Spiked Bat, Guitar) reuse the 07 GLB with `"mirror": true`.

Gaps seen in the previews (most common first): rear horns (Big Horn, Big Black Horns, Miyuki Horn), boots, Back (Wings,
Cape), collars, most guns/whips/gloves (Golden Uzi, Uzi, Boxing Glove, Little Thrasher, Bullwhip, Small Knife), most hair
cards (only Miyuki, Yamarashii, Hikaru, Nao exist in 3D) and rear hair. Hair placement in the compare render is an
approximation of the builder's (Nao turned 90° in Blender's frame).

## Generator verdicts (owner review in the 3D viewer)

| Source | Part | Verdict |
|---|---|---|
| Anything.world | Hikaru hair, Nao hair (and Miyuki, Yamarashii) | **good** |
| Tripo | Ayumi mask, Kimi, Racing Goggles | good |
| Tripo | Glasses | good enough (needs pitch −90°) |
| Tripo | Miami Sunglasses | almost good, needs bend |
| Tripo | Plain | wrong shape (was close) |
| Tripo | Yama, Payne Patch, Medical, Spiked, Studded, Polkadot, Bluetooth Mic | **flat, useless** |
| Tripo | Phi-Phi horns | thick but flat, wrong shape |
| Tripo | Mecha-Style | dark band over the mouth, not judged |

Measured depth as % of width: flat ones are 2–17%. The good ones are 26–83%.

**Takeaway:** Tripo image-to-3D from a single front-on card can't guess depth for thin parts. It does fine on bulky ones. Anything.world has been better on everything tried so far (only hair so far).

Card art note: **Medical** = heart patch, **Payne Patch** = red-cross patch. The models match their cards.

## Costs and accounts

- **Tripo:** about 25 credits per textured model. About 25 credits left after this batch. One parallel run lost 300 credits (jobs started, IDs lost). Always run jobs one at a time and save task IDs. The key is `TRIPO_3D_SECRET_KEY` in `NPGX Mint/.env.local`.
- **Anything.world:** 5 credits per model. Two accounts have keys in `.env.local` (`ANYTHING_WORLD_API_KEY_BOASE`, `_NPG`), 15 free credits each per month. **The API is locked** ("Unauthorized processing"). Email support@anything.world to enable it. The web app works.
- Rigid-part cards still to do: about 176 (78 weapons, 47 hair + rear hair, 27 boots, 8 horns, 16 collars, jewellery and back).
- Clothing, body and face cards (about 150) need a different approach (skinned to the rig, or painted as textures), not image-to-3D.

## Next steps

1. Put one Tripo-flat card (Payne or Polkadot) through the Anything.world web app and compare it side by side in Inspect.
2. If Anything.world wins, ask support to enable the API, then batch the rest. Ask the owner before any spend.
3. ~~For simple masks: put the card art as a texture onto the base (Ayumi) mask mesh.~~ Done: all 14 mask cards as "(wrapped)" in the Stack Builder, `public/arena/models/npg/stack/masks/`. Pipeline in `scripts/npg-masks/` (prep.py crops the card, wrap.py projects it front-on in Blender, render.py makes a contact sheet). Mouth masks ride the base mask mesh; eye-level cards (glasses, goggles, patches) ride the front of the head mesh, 3 mm out. Registration constants in `register.py` / `wrap.py`.
4. ~~Weapons: test 2–3 before buying credits for the set.~~ Hand-modelled instead (see above).
5. Map the remaining categories to bones (feet, chest). Hands done (`item.L` / `item.R`).

## Chibi animation (in progress)

- The chibi base is fully rigged: 84 bones, IK, finger bones, and `item.L`/`item.R` weapon sockets. It came with no animations.
- Stopgap clips made in code: `src/lib/chibiAnims.ts` (idle, walk, run). Rotations are written in the character's own axes and converted to each bone's axes in code.
- She's in the arena as `chibi`: 2 roam the maze, and she roams from the first corridor with `?showcase`.
- Mixamo clips downloaded by the owner and waiting in `~/Downloads`: `Walking.fbx`, `Walking (1).fbx` (different files, not duplicates) and `Zombie Idle.fbx`. Still to do: convert FBX to GLB (the `fbx2gltf` npm package has no binary, so use Blender or three's FBXLoader), retarget the `mixamorig:*` bones to the chibi's bones, and add run, shoot, hit and death clips.
