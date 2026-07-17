#!/usr/bin/env bash
#
# fetch-assets.sh — download the Sponza test scene + stage the KTX2/Draco decoders.
#
# Idempotent: skips anything already present. Safe to re-run.
#
# What it does:
#   1. Downloads toji/sponza-optimized `Sponza-KTX-Draco.glb` (~9.7 MB, 100% standard
#      glTF: KHR_draco_mesh_compression + KHR_texture_basisu/KTX2) into bench/assets/.
#      (Asset choice + URL: research/sponza-asset-comparison.md.)
#   2. Copies the Draco + Basis/KTX2 decoder blobs OUT OF the installed three package
#      (node_modules/three/examples/jsm/libs/{draco,basis}) into bench/public/decoders/
#      so Vite serves them at /decoders/... at runtime. We copy from node_modules rather
#      than fetch from a CDN so the decoder version always matches the pinned three@0.185.1
#      (a mismatched transcoder silently corrupts textures). CSP/offline-friendly too.
#
# bench/assets/ and bench/public/decoders/ are BOTH gitignored (derived artifacts).

set -euo pipefail

# Resolve bench/ dir regardless of where this is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ASSETS_DIR="$BENCH_DIR/assets"
DECODERS_DIR="$BENCH_DIR/public/decoders"
THREE_LIBS="$BENCH_DIR/node_modules/three/examples/jsm/libs"

SPONZA_URL="https://github.com/toji/sponza-optimized/raw/main/Sponza-KTX-Draco.glb"
SPONZA_OUT="$ASSETS_DIR/Sponza-KTX-Draco.glb"

echo "==> SSGI bench asset fetch"

# --- 1. Sponza glb -----------------------------------------------------------
mkdir -p "$ASSETS_DIR"
if [ -f "$SPONZA_OUT" ]; then
  echo "  [skip] $SPONZA_OUT already present ($(du -h "$SPONZA_OUT" | cut -f1))"
else
  echo "  [get ] $SPONZA_URL"
  # -L follow redirects (GitHub raw -> codeload), -f fail on HTTP error.
  curl -fL --retry 3 -o "$SPONZA_OUT" "$SPONZA_URL"
  echo "  [ ok ] $SPONZA_OUT ($(du -h "$SPONZA_OUT" | cut -f1))"
fi

# --- 2. Decoders from the installed three package ----------------------------
if [ ! -d "$THREE_LIBS" ]; then
  echo "  [err ] $THREE_LIBS not found — run 'pnpm install' first." >&2
  exit 1
fi

mkdir -p "$DECODERS_DIR"

if [ -d "$DECODERS_DIR/draco" ]; then
  echo "  [skip] decoders/draco already staged"
else
  echo "  [copy] draco decoder -> public/decoders/draco"
  cp -R "$THREE_LIBS/draco" "$DECODERS_DIR/draco"
fi

if [ -d "$DECODERS_DIR/basis" ]; then
  echo "  [skip] decoders/basis already staged"
else
  echo "  [copy] basis transcoder -> public/decoders/basis"
  cp -R "$THREE_LIBS/basis" "$DECODERS_DIR/basis"
fi

echo "==> done."
