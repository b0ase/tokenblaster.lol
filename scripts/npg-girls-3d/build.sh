#!/usr/bin/env bash
# CHOOSE YOUR GIRL 3D models: NPG chibi body + hair GLBs -> public/terrornode/girls3d (meshopt, 512px webp textures).
# Source assets live in the ninja-punk-girls-com repo (read only). Usage: scripts/npg-girls-3d/build.sh [npg-repo]
set -euo pipefail
NPG=${1:-/Volumes/2026/Projects/ninja-punk-girls-com}/public/3D_assets
OUT=$(cd "$(dirname "$0")/../.." && pwd)/public/terrornode/girls3d
TMP=$(mktemp -d); mkdir -p "$OUT"
GT="pnpm dlx @gltf-transform/cli@4"
run() { # src dst simplifyRatio
  $GT resize "$1" "$TMP/a.glb" --width 512 --height 512 >/dev/null
  $GT webp "$TMP/a.glb" "$TMP/b.glb" --quality 80 >/dev/null
  if [ "$3" != "1" ]; then $GT simplify "$TMP/b.glb" "$TMP/c.glb" --ratio "$3" --error 0.002 >/dev/null; else cp "$TMP/b.glb" "$TMP/c.glb"; fi
  $GT optimize "$TMP/c.glb" "$2" --compress meshopt --simplify false --texture-compress false --instance false --join false --flatten false >/dev/null
}
run "$NPG/chibi_cyberpunk_final.glb" "$OUT/chibi.glb" 1
for h in E001MiyukiHair E002YamarashiiHair E003HikaruHair E011NaoHair; do run "$NPG/npg_hair/$h.glb" "$OUT/$h.glb" 0.15; done
ls -l "$OUT"; rm -rf "$TMP"
