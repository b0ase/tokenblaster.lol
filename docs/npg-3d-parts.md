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

- Every part attaches to a bone. Today that's only the `head` bone. Planned: hair, horns and mask on the head; weapons on `hand.L`/`hand.R`; boots on the feet; tops on the chest.
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
3. For simple masks: put the card art as a texture onto the base (Ayumi) mask mesh. It's free and always the right shape.
4. Weapons: test 2–3 before buying credits for the set.
5. Map the remaining categories to bones (hands, feet, chest).
