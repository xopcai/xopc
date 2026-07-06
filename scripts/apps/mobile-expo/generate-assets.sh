#!/usr/bin/env bash
# Generate Expo PNG assets from the xopc web logo sources.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ICON_SRC="${REPO_ROOT}/web/public/favicon.svg"
ADAPTIVE_SRC="${REPO_ROOT}/web/public/logo-dark.svg"
ASSETS="${REPO_ROOT}/apps/mobile-expo/assets"

for src in "$ICON_SRC" "$ADAPTIVE_SRC"; do
  if [[ ! -f "$src" ]]; then
    echo "Missing logo source: $src" >&2
    exit 1
  fi
done

mkdir -p "$ASSETS"
RESVG=(pnpm dlx @resvg/resvg-js-cli)

render() {
  local svg="$1"
  local png="$2"
  local size="$3"
  "${RESVG[@]}" --fit-width "$size" "$svg" "$png"
  echo "  $(basename "$png") (${size}x${size})"
}

echo "Generating assets from $ICON_SRC"
render "$ICON_SRC" "${ASSETS}/icon.png" 1024
render "$ICON_SRC" "${ASSETS}/splash-icon.png" 1024
render "$ICON_SRC" "${ASSETS}/favicon.png" 48

# Android adaptive icon uses a transparent white foreground over app.json backgroundColor #000000.
echo "Generating adaptive icon foreground from $ADAPTIVE_SRC"
render "$ADAPTIVE_SRC" "${ASSETS}/adaptive-icon.png" 1024

echo "Done → $ASSETS"
