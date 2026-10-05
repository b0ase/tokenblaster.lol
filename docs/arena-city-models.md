# Arena monsters and Satoshi City pedestrians: Sketchfab models

Downloaded with the Sketchfab download API, optimised with gltf-transform
(`optimize --compress meshopt --texture-compress webp`, textures 512–1024 px). All CC BY 4.0.

| File | Used for | Model | Author | Source | Size |
|---|---|---|---|---|---|
| `public/arena/models/monsters/raptor.glb` | Arena: fast melee monster (replaces the old spider thing) | PBR Velociraptor (Animated) | Ferocious Industries (ferociousindustries.matthias) | https://sketchfab.com/3d-models/pbr-velociraptor-animated-8f1744af7b0847a2aabe3df90be802f0 | 0.8 MB |
| `public/arena/models/monsters/zombie.glb` | Arena: maze + horde-hall shambler | Low Poly Zombie (Game Animation) | Jerome Angeles (jeromeangeles) | https://sketchfab.com/3d-models/low-poly-zombie-game-animation-9f8f0885b2f94c6890c4debaceac9421 | 0.7 MB |
| `public/city/models/ped_bearded.glb` | Satoshi City pedestrian | Bearded man - Low poly animated | Agor_2012 (Agor_) | https://sketchfab.com/3d-models/bearded-man-low-poly-animated-5718a53d18a142f686b1d9f02a637773 | 0.79 MB |
| `public/city/models/ped_shirt.glb` | Satoshi City pedestrian | Low poly ordinary man in shirt and pants | Agor_2012 (Agor_) | https://sketchfab.com/3d-models/low-poly-ordinary-man-in-shirt-and-pants-f658b9e1bb324f2ab1e9f00d7d6b4065 | 0.48 MB |
| `public/city/models/ped_female.glb` | Satoshi City pedestrian | Low Poly Female | Loves_Art | https://sketchfab.com/3d-models/low-poly-female-07eeb124d210402bbc061e543d0b97a1 | 0.14 MB |

Notes:
- The raptor ships 26 clips; only Idle_01, Walk, Sprint, Bite_01, Hurt_01 and Death_01 are kept. Its
  spec-gloss materials were converted to metal-rough (`gltf-transform metalrough`): three.js no longer reads
  KHR_materials_pbrSpecularGlossiness.
- Satoshi City cars were already real models (`public/arcade/frogger/vehicles/`), unchanged.
- If a monster model fails to load, the Arena gives that monster another loaded model's body. If no
  pedestrian model loads, the city has no walkers.
