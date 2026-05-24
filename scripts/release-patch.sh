#!/usr/bin/env bash
# Patch release: sync → build → test → lint → bump patch versions → commit → tag → atomic push.
# Requires a clean git working tree on a branch. Uses remote GIT_REMOTE (default: origin).
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

BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [[ -z "$BRANCH" ]]; then
  echo "error: must be on a branch (detached HEAD); checkout main (or your release branch) first." >&2
  exit 1
fi

run_release_step "git fetch ${REMOTE}" git fetch "${REMOTE}"

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [[ -z "$UPSTREAM" ]]; then
  UPSTREAM="${REMOTE}/${BRANCH}"
fi

REMOTE_BRANCH_SHA="$(git rev-parse --verify "${UPSTREAM}^{commit}" 2>/dev/null || true)"
if [[ -z "$REMOTE_BRANCH_SHA" ]]; then
  echo "error: ${UPSTREAM} not found after fetch; set upstream or push the branch once." >&2
  exit 1
fi

LOCAL_SHA="$(git rev-parse HEAD)"
if [[ "$LOCAL_SHA" == "$REMOTE_BRANCH_SHA" ]]; then
  : # in sync
elif git merge-base --is-ancestor "$LOCAL_SHA" "$REMOTE_BRANCH_SHA" 2>/dev/null; then
  echo "error: local ${BRANCH} is behind ${UPSTREAM}; pull or rebase before releasing." >&2
  exit 1
elif git merge-base --is-ancestor "$REMOTE_BRANCH_SHA" "$LOCAL_SHA" 2>/dev/null; then
  : # ahead of remote (unreleased commits) — ok
else
  echo "error: local ${BRANCH} has diverged from ${UPSTREAM}; rebase or merge before releasing." >&2
  exit 1
fi

NEXT_VER="$(node "$ROOT/scripts/bump-patch-version.mjs" --print-next)"
TAG="v${NEXT_VER}"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag ${TAG} already exists locally." >&2
  exit 1
fi
if git ls-remote --exit-code --tags "${REMOTE}" "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "error: tag ${TAG} already exists on ${REMOTE}." >&2
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

RELEASE_SHA="$(git rev-parse HEAD)"
echo "==> git push --atomic ${REMOTE} HEAD ${TAG}"
run_release_step "git push --atomic ${REMOTE} (HEAD + ${TAG})" \
  git push --atomic "${REMOTE}" HEAD "${TAG}"

REMOTE_TAG_SHA="$(git ls-remote "${REMOTE}" "refs/tags/${TAG}^{}" | awk '{print $1}')"
if [[ "$REMOTE_TAG_SHA" != "$RELEASE_SHA" ]]; then
  echo "error: remote tag ${TAG} is missing or does not point to ${RELEASE_SHA} (got ${REMOTE_TAG_SHA:-none})." >&2
  exit 1
fi

REMOTE_HEAD_SHA="$(git ls-remote "${REMOTE}" "refs/heads/${BRANCH}" | awk '{print $1}')"
if [[ "$REMOTE_HEAD_SHA" != "$RELEASE_SHA" ]]; then
  echo "error: remote branch ${BRANCH} is not at release commit ${RELEASE_SHA} (got ${REMOTE_HEAD_SHA:-none})." >&2
  exit 1
fi

echo "Released ${TAG} (${RELEASE_SHA}) to ${REMOTE}/${BRANCH}"
