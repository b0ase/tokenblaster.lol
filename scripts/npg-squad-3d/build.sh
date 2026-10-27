#!/usr/bin/env bash
# TERRORNODE squad + CHOOSE YOUR GIRL 3D: the Tripo NPG rigged girls (public/npg/cards/<slug>-rigged.glb, the same
# Mixamo-boned models NPG Arena uses) with their 4096px textures cut to 1024px webp -> public/terrornode/squad.
# 4096px x2 per girl x5 girls is ~900MB of GPU memory; 1024px is ~1/16 of that. Geometry and bones untouched.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$ROOT/public/terrornode/squad
TMP=$(mktemp -d); mkdir -p "$OUT"
GT="pnpm dlx @gltf-transform/cli@4"
for s in aika ayumi kimiko nao kazuyo; do
  $GT resize "$ROOT/public/npg/cards/$s-rigged.glb" "$TMP/a.glb" --width 1024 --height 1024 >/dev/null
  $GT webp "$TMP/a.glb" "$OUT/$s.glb" --quality 82 >/dev/null
done
ls -l "$OUT"; rm -rf "$TMP"
