# NPG 3D: lessons learned

This is a running log of what has worked and what hasn't when turning NPG cards into 3D parts. Read it before starting any NPG 3D task. Add an entry after every test, and record the owner's verdict in their own words.

Method details are in [npg-3d-parts.md](npg-3d-parts.md).

## Rules (from owner verdicts)

1. **Check what already exists before building anything.** Look at:
   - The chibi doll's own parts: mohawk hair, gas mask, sai, outfit and boots.
   - The Anything.world models: hair E001, E002, E003 and E011, the M011 Mecha mask, `miyuki.glb` and `miyuki_parts.glb`.
   - The good Tripo masks: Ayumi, Kimi, Racing Goggles and Glasses.
   - The models in `ninja-punk-girls-com/public/3D_assets`.

   Build only what is missing. Two whole rounds were wasted rebuilding the mohawk and the sai, and both came out worse than the existing models.
2. **Judge every part as an AAA game asset.** Look at the renders yourself; a good score doesn't make a good model. The owner rejected the TripoSR horn and bat, which I had called "good".
3. **Crisp edges and clear detail come first.** Matching the card's outline is only a rough guide, at about 80% overlap. A hard ≥0.90 overlap gate made Phi-Phi blobby.
4. **Proportions come from the card.** Use one scale for every part: 0.00107 m per card pixel. Keep height:width within about 5% of the card, and take placement from the shared card canvas.
5. **A flat colour reads as plastic.** Bake an illustrated texture, the Phi-Phi v5 style:
   - two-tone paint with a darker rim;
   - ink on seams;
   - highlight streaks and chips.

   Check the bake is actually wired into the material (v4 bug).
6. **Show the owner before and after sheets** (card next to the model from front, 3/4, side and back, plus the model on the chibi) before pushing anything.
7. **Never run machine-wide kills** such as `pkill` or `killall`. Stop only the process IDs you started.

## What works

| Technique | Good for | Evidence |
|---|---|---|
| Hand-modelling in headless Blender, then card_bake | Rigid parts: weapons, horns, helmets, plates | Phi-Phi v5 ("really nice"), Big Red Horns, Spiked Bat, Scarlet Horns |
| Wrapping mask cards onto the chibi's own mask mesh | Mouth masks and eye patches | Wrapped masks v2 (the owner preferred v2) |
| Anything.world | Hair, and anything with flowing volume | Hikaru, Nao, Miyuki and Yamarashii hair judged good |
| Placing parts from the card canvas | Getting the angle, grip and position right | Weapon placement overlap rose from 0–0.38 to 0.41–0.94 |
| `compare_stack.py` overlays | Checking the 3D girl against a real 2D NPG | 7 previews line up with no fudging |

## What doesn't work

| Attempt | Why it failed |
|---|---|
| Tripo / TripoSR image-to-3D on single cards | A single front-on image gives no depth, so thin parts come out flat and bulky ones come out lumpy and blurry. The owner judged them flat and useless, and TripoSR's output "crap". |
| Thick cut-outs (extruded PNG outlines) | "2D 3D objects": no real volume. |
| Pressing whole masks flat against the face (v3) | Lost the mask's own form; v2 was better. |
| Hand-built hair (Mohawk test) | Came out as separate petal shards: no scalp base, no layering, gaps between locks. The existing chibi mohawk is far better. |
| Very subtle bakes (v4) | Read exactly like flat colour. |

## Why the good models are good (from comparisons)

- **Hair:** many small, sharp, layered spikes grow from a proper scalp shell with shaved sides, and sweep from forehead to nape as one mass. Ours had about 15 big petals with gaps between them. Next time, start from the existing hair mesh and reshape or recolour it rather than building from scratch.
- **Phi-Phi v5:** keeps the batch-1 geometry with crisp bevels. The baked rims and ink make it read like the card.

## Next tests to try

- Card variants built by reshaping and recolouring the existing mohawk and Anything.world hair, instead of new builds.
- A brighter steel recipe for blades (Katana, Sai, Machete), which currently read dark.

## Log

- **2026-10-04:** Tripo batch of 15 masks. 4 good; the thin ones came out flat.
- **2026-10-07:** Wrapped masks v1 to v4. The owner chose v2.
- **2026-10-08:**
  - Thick cut-outs rejected.
  - TripoSR rejected.
  - Hand-modelling adopted.
  - The overlap gate backfired.
  - Phi-Phi v5 bake approved.
  - Batches 1 and 2 shipped.
- **2026-10-09:**
  - Hand-built hair rejected (6.5/10).
  - The owner pointed out we had rebuilt existing models, so rule 1 was added.

### 2026-10-12: whole-card test, Phi-Phi (verdict: "rekt. That's not Phi Phi...")
- **Test:** a random full stack (22 parts) rendered on the chibi base doll using only parts that already exist in 3D (Spikes horns,
  graffiti can, and the doll's own mohawk and mask), then composited into the real card frame.
- **Why it failed:** 3 of 22 parts existed. The doll's default outfit, blue eyes and taller proportions replaced the card's jacket,
  shirt, trousers, sneakers, Erobot face, horns, wings, rear hair and ball-and-chain. The result is a different girl.
- **Lesson:** a part-by-part build on the generic doll can't show a specific character until nearly all of her parts exist.
  Judge the whole girl, not the pipeline. Next, test whole-character generation from the composited card art.

### 2026-10-12: whole-character generation, canonical Phi-Phi via Tripo website (H3.1 Best Quality)
- **Input:** her canonical parts composited front-on on white, no card frame (`character: Phi-Phi` parts only, both axes held).
- **Result:** a faithful model, readable from every side: drill helmet, red bunches, fanged face, corset, fishnet sleeves, red
  boots and both Red Axes. It composites into the card at the 2D girl's size and centre line and matches the art closely.
  Owner had called the web preview "a pretty good model" (final verdict on the card render pending).
- **Compared with local TripoSR on the same image:** blobby, axes melted into the hair, the back is mush. Not usable.
- **Gaps:** 1.93M triangles and 66 MB, far too heavy for the web, so it needs decimating to about 50–100k triangles and
  compressed textures. The surfaces are very glossy, so turn roughness up for the card look. It's unrigged.
- **Cost:** the website free plan can't export, so it needs a paid plan or API credits (an API textured model costs more than
  25 credits).
- **Lesson:** for "the character on the card", generate the whole girl from her composited stack. Don't assemble her part by
  part on the generic doll.

### 2026-10-12: cutting parts out of a whole Tripo girl (projection mask): FAILS
- **Method:** the part card's alpha was used as a stencil on Phi-Phi's Tripo model (front-visible faces plus colour match), then
  holes were filled. Tried on the 09_001 helmet, 24_003 Red Bunches and 07_003 Red Axe.
- **Result:** all three unusable. The helmet comes out as torn shreds, because Tripo fuses it into the head as one painted
  surface. The bunches are about 1 cm ribbon shells, and the axe is a ragged, paper-thin decal.
- **Lesson:** a whole-girl Tripo model only has real depth in the body. Accessories are fused, shell-thin or hidden, and
  selecting more carefully can't add geometry that isn't there. For parts, stay with hand-built + card_bake (rigid parts) and
  Anything.world (hair).
