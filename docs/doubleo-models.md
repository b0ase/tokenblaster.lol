# Double-O Kweg: rigged character models

Downloaded from Sketchfab (download API), optimised with gltf-transform
(`optimize --compress meshopt --texture-compress webp --texture-size 1024`) into `public/arena/models/doubleo/`.
Loaded by `loadCastModels()` in `src/lib/doubleo/characters.ts`; if one fails to load, that character falls
back to the procedural box rig. Bosses stay procedural cartoon parodies (no real likenesses).

| File | Used for | Model | Author | Licence | Source | Size |
|---|---|---|---|---|---|---|
| `agent.glb` | Other players' agents (suit tinted per player, lapel pin) | Business Man - Low Polygon game character | manoeldarochadeoliveira | CC BY 4.0 | https://sketchfab.com/3d-models/b6f6740f883b4749abac47af0045a9dd | 0.78 MB |
| `goon.glb` | Paper-Wallet Goon (paper wallet pinned on) | Mob_Suit ( Downtown 1930s Mafia ) | xdddddqwue12h31 | CC BY 4.0 | https://sketchfab.com/3d-models/7ac49b3f13ea4ab481eb80053140c2bb | 0.16 MB |
| `bot.glb` | Guard Bot | Evil Robot – Game-Ready | charliecatling | CC BY 4.0 | https://sketchfab.com/3d-models/5918ff9fae3342e59a76a919bf89391a | 1.1 MB |

Clips used: agent `Rig|idle` / `Rig|walk` / `Rig|run`; goon `idle_patrol` / `walk_patrol` / `run` / `death_1`;
bot `Armature|idol` / `Armature|walk.001` / `Armature|death .001` (its `thwamp` clip leaps about, so it is not used).
Changes: rescaled, recoloured (agent suit tint, goon's untextured Thompson made gunmetal, bot eyes made emissive),
props added in code.
