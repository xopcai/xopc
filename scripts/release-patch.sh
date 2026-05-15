#!/usr/bin/env bash
# Patch release: build → test → lint → bump patch versions → commit → tag → push.
# Requires a clean git working tree. Uses remote GIT_REMOTE (default: origin).
set -euo pipefail

# Explicit checks: do not rely on set -e alone (pnpm/npm script chains can be subtle).
run_release_step() {
  local label="$1"
  shift
  echo "==> ${label}"
  if ! "$@"; then
    echo "error: ${label} failed; release aborted (no version bump, commit, tag, or push)." >&2
    exit 1
  fi
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
REMOTE="${GIT_REMOTE:-origin}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash changes first." >&2
  exit 1
fi

NEXT_VER="$(node "$ROOT/scripts/bump-patch-version.mjs" --print-next)"
TAG="v${NEXT_VER}"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag ${TAG} already exists locally." >&2
  exit 1
fi

run_release_step "pnpm run build" pnpm run build
run_release_step "pnpm test" pnpm test
run_release_step "pnpm run lint" pnpm run lint

NEXT_VER="$(node "$ROOT/scripts/bump-patch-version.mjs")"
TAG="v${NEXT_VER}"

git add \
  package.json \
  web/package.json \
  packages/extension-ui-sdk/package.json \
  extensions/telegram/package.json \
  extensions/telegram/xopc.extension.json

git commit -m "chore: release ${TAG}"

git tag -a "${TAG}" -m "${TAG}"

echo "==> git push ${REMOTE} HEAD && git push ${REMOTE} ${TAG}"
git push "${REMOTE}" HEAD
git push "${REMOTE}" "${TAG}"

echo "Released ${TAG}"
