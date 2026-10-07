# Token Rally: asset credits

Everything under `public/rally/` is CC0 (public domain). No attribution is required; it is given anyway.

| Path | What | Author | License |
|------|------|--------|---------|
| `cars/*.glb` | Car Kit (hatchback-sports, race, sedan-sports, suv, suv-luxury, taxi, police, truck, van, delivery) | Kenney (kenney.nl/assets/car-kit) | CC0 1.0 (`cars/LICENSE-kenney-car-kit.txt`) |
| `nature/*.glb` | Nature Kit (trees, rocks, cacti, plants, logs) | Kenney (kenney.nl/assets/nature-kit) | CC0 1.0 (`nature/LICENSE-kenney-nature-kit.txt`) |
| `tex/forest_*`, `tex/desert_*`, `tex/snow_*`, `tex/road_*`, `tex/rock_*` | PBR ground sets: `forrest_ground_01`, `cracked_red_ground`, `snow_02`, `gravel`, `rock_boulder_cracked` | Poly Haven (polyhaven.com) | CC0 1.0 |
| `hdr/forest.hdr`, `hdr/desert.hdr`, `hdr/snow.hdr` | Sky + image-based lighting: `kloofendal_48d_partly_cloudy_puresky`, `kloofendal_43d_clear_puresky`, `kloofendal_overcast_puresky` (1k) | Greg Zaal / Poly Haven | CC0 1.0 |

Processing done here: textures resized and re-encoded to WebP; Kenney glTF files compressed with meshopt (`@gltf-transform/cli meshopt`) with the colour map embedded; unused models dropped. No other changes.
