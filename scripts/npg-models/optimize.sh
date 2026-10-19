#!/usr/bin/env bash
# Lossless-ish size pass for the NPG character GLBs with glTF-Transform: dedup, prune, weld, quantize, meshopt.
# No simplification and no texture re-encoding: geometry and art stay as built, so the look doesn't change.
# Writes to out/npg-models/optimized/ for side-by-side review; nothing in public/ is touched.
# Usage: scripts/npg-models/optimize.sh [id ...]   (three.js loads it with GLTFLoader.setMeshoptDecoder)
set -euo pipefail
cd "$(dirname "$0")/../.."
out=out/npg-models/optimized; mkdir -p "$out"
ids=("$@"); [ ${#ids[@]} -eq 0 ] && ids=($(ls public/npg/cards/*-rigged.glb | xargs -n1 basename | sed 's/-rigged.glb//'))
for id in "${ids[@]}"; do
  src=public/npg/cards/$id-rigged.glb; dst=$out/$id-rigged.glb
  pnpm dlx @gltf-transform/cli@4 optimize "$src" "$dst" --compress meshopt --simplify false --texture-compress false --instance false >/dev/null
  pnpm dlx @gltf-transform/cli@4 validate "$dst" 2>&1 | grep -q 'No errors found' || echo "$id VALIDATION ERRORS"
  printf '%-14s %8s -> %8s\n' "$id" "$(du -h "$src" | cut -f1)" "$(du -h "$dst" | cut -f1)"
done
