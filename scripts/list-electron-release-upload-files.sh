#!/usr/bin/env bash
# List Electron artifacts safe to publish on GitHub Releases.
# electron-builder also emits win-unpacked/xopc.exe (~200MB); it is not an NSIS installer
# and fails when downloaded alone — exclude the whole win-unpacked tree.
set -euo pipefail

ROOT="${1:-release-assets}"

if [[ ! -d "$ROOT" ]]; then
  echo "list-electron-release-upload-files: directory not found: $ROOT" >&2
  exit 1
fi

find "$ROOT" -type f \( \
  -name '*.exe' -o \
  -name '*.dmg' -o \
  -name '*.zip' -o \
  -name '*.AppImage' -o \
  -name '*.deb' -o \
  -name '*.rpm' -o \
  -name '*.snap' -o \
  -name 'latest*.yml' \
\) \
  ! -path '*/win-unpacked/*' \
  ! -name 'elevate.exe' \
  ! -name 'rg.exe' \
  ! -name 'builder-*.yml' \
  | sort
