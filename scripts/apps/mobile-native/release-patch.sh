#!/usr/bin/env bash
# Native mobile patch release: verify both apps, bump their shared version, tag, and push atomically.
# The Android and iOS tags trigger their independent signed release workflows.
set -euo pipefail

run_release_step() {
  local label="$1"
  shift
  echo "==> ${label}"
  if ! "$@"; then
    echo "error: ${label} failed; release aborted." >&2
    exit 1
  fi
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
REMOTE="${GIT_REMOTE:-origin}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash changes first." >&2
  exit 1
fi

BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [[ -z "$BRANCH" ]]; then
  echo "error: must be on a branch; detached HEAD releases are not supported." >&2
  exit 1
fi

for command in node pnpm xcodegen xcodebuild swiftformat swiftlint; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "error: required release command is unavailable: ${command}" >&2
    exit 1
  fi
done

run_release_step "git fetch ${REMOTE}" git fetch "$REMOTE"
UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [[ -z "$UPSTREAM" ]]; then
  UPSTREAM="${REMOTE}/${BRANCH}"
fi
REMOTE_BRANCH_SHA="$(git rev-parse --verify "${UPSTREAM}^{commit}" 2>/dev/null || true)"
if [[ -z "$REMOTE_BRANCH_SHA" ]]; then
  echo "error: ${UPSTREAM} was not found after fetch." >&2
  exit 1
fi
LOCAL_SHA="$(git rev-parse HEAD)"
if [[ "$LOCAL_SHA" == "$REMOTE_BRANCH_SHA" ]]; then
  :
elif git merge-base --is-ancestor "$LOCAL_SHA" "$REMOTE_BRANCH_SHA" 2>/dev/null; then
  echo "error: local ${BRANCH} is behind ${UPSTREAM}." >&2
  exit 1
elif ! git merge-base --is-ancestor "$REMOTE_BRANCH_SHA" "$LOCAL_SHA" 2>/dev/null; then
  echo "error: local ${BRANCH} has diverged from ${UPSTREAM}." >&2
  exit 1
fi

NEXT_VERSION="$(node scripts/apps/mobile-native/bump-patch-version.mjs --print-next)"
ANDROID_TAG="mobile-android-v${NEXT_VERSION}"
IOS_TAG="mobile-ios-v${NEXT_VERSION}"
for tag in "$ANDROID_TAG" "$IOS_TAG"; do
  if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "error: tag ${tag} already exists locally." >&2
    exit 1
  fi
  if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/${tag}" >/dev/null 2>&1; then
    echo "error: tag ${tag} already exists on ${REMOTE}." >&2
    exit 1
  fi
done

run_release_step "native Android unit tests and debug build" \
  bash -c 'cd apps/mobile-android && ./gradlew :app:testDebugUnitTest :app:assembleDebug'
run_release_step "native iOS formatting" \
  bash -c 'cd apps/mobile-ios && swiftformat XopcMobile XopcMobileTests XopcMobileUITests --lint'
run_release_step "native iOS lint" \
  bash -c 'cd apps/mobile-ios && swiftlint lint --strict --config .swiftlint.yml'
run_release_step "generate native iOS project" \
  bash -c 'cd apps/mobile-ios && xcodegen generate'
run_release_step "verify generated native iOS project is committed" \
  git diff --exit-code -- apps/mobile-ios/XopcMobile.xcodeproj/project.pbxproj
run_release_step "native iOS unit tests" \
  bash -c "cd apps/mobile-ios && xcodebuild -project XopcMobile.xcodeproj -scheme XopcMobile -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:XopcMobileTests CODE_SIGNING_ALLOWED=NO test"
run_release_step "shared agent stream tests" pnpm run mobile:test:stream

RELEASE_VERSION="$(node scripts/apps/mobile-native/bump-patch-version.mjs)"
if [[ "$RELEASE_VERSION" != "$NEXT_VERSION" ]]; then
  echo "error: version changed during release preflight (${NEXT_VERSION} -> ${RELEASE_VERSION})." >&2
  exit 1
fi
run_release_step "regenerate native iOS project for ${RELEASE_VERSION}" \
  bash -c 'cd apps/mobile-ios && xcodegen generate'

git add \
  apps/mobile-android/app/build.gradle.kts \
  apps/mobile-ios/project.yml \
  apps/mobile-ios/XopcMobile.xcodeproj/project.pbxproj
git commit -m "chore: release native mobile v${RELEASE_VERSION}"
git tag -a "$ANDROID_TAG" -m "$ANDROID_TAG"
git tag -a "$IOS_TAG" -m "$IOS_TAG"

RELEASE_SHA="$(git rev-parse HEAD)"
run_release_step "push branch and native mobile tags atomically" \
  git push --atomic "$REMOTE" HEAD "$ANDROID_TAG" "$IOS_TAG"

for tag in "$ANDROID_TAG" "$IOS_TAG"; do
  remote_tag_sha="$(git ls-remote "$REMOTE" "refs/tags/${tag}^{}" | awk '{print $1}')"
  if [[ "$remote_tag_sha" != "$RELEASE_SHA" ]]; then
    echo "error: remote tag ${tag} does not point to ${RELEASE_SHA}." >&2
    exit 1
  fi
done
REMOTE_HEAD_SHA="$(git ls-remote "$REMOTE" "refs/heads/${BRANCH}" | awk '{print $1}')"
if [[ "$REMOTE_HEAD_SHA" != "$RELEASE_SHA" ]]; then
  echo "error: remote branch ${BRANCH} is not at ${RELEASE_SHA}." >&2
  exit 1
fi

echo "Released native Android and iOS ${RELEASE_VERSION} (${RELEASE_SHA})."
echo "GitHub Actions will publish the signed Android artifacts and upload the signed iOS IPA to TestFlight."
