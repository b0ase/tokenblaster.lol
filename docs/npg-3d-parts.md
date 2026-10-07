# NPG 3D part cards

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
- **Right-weapon cards (07) draw the weapon in the character's LEFT hand** (viewer's right), so they go on `item.L`. Left-weapon cards (08) will go on `item.R`.
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
- Quality bar: clean stylised prop, bevels, crisp flat colours, ≤3k tris (Phi-Phi is 3.6k, kept as approved). Look at the card first, render card vs front / ¾ / side / back (`render_views.py` + `compare.py`), critique, iterate at least twice.
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
