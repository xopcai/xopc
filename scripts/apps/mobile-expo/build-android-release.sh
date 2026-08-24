#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-both}"

case "$TARGET" in
  apk|aab|both) ;;
  *)
    echo "Usage: $0 [apk|aab|both]" >&2
    exit 2
    ;;
esac

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Error: missing required environment variable: $name" >&2
    exit 1
  fi
}

require_value ANDROID_KEYSTORE_PATH
require_value ANDROID_KEYSTORE_PASSWORD
require_value ANDROID_KEY_ALIAS
require_value ANDROID_KEY_PASSWORD

if [[ ! -f "$ANDROID_KEYSTORE_PATH" ]]; then
  echo "Error: Android keystore not found: $ANDROID_KEYSTORE_PATH" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/mobile-expo"
OUTPUT_DIR="${APP_DIR}/dist/android"

echo "Generating the Android native project..."
pnpm -C "$APP_DIR" exec expo prebuild --platform android --clean --no-install

export ORG_GRADLE_PROJECT_XOPC_UPLOAD_STORE_FILE="$ANDROID_KEYSTORE_PATH"
export ORG_GRADLE_PROJECT_XOPC_UPLOAD_STORE_PASSWORD="$ANDROID_KEYSTORE_PASSWORD"
export ORG_GRADLE_PROJECT_XOPC_UPLOAD_KEY_ALIAS="$ANDROID_KEY_ALIAS"
export ORG_GRADLE_PROJECT_XOPC_UPLOAD_KEY_PASSWORD="$ANDROID_KEY_PASSWORD"

gradle_tasks=()
if [[ "$TARGET" == "apk" || "$TARGET" == "both" ]]; then
  gradle_tasks+=(":app:assembleRelease")
fi
if [[ "$TARGET" == "aab" || "$TARGET" == "both" ]]; then
  gradle_tasks+=(":app:bundleRelease")
fi

echo "Building Android release target: $TARGET"
(cd "${APP_DIR}/android" && ./gradlew "${gradle_tasks[@]}" --stacktrace)

mkdir -p "$OUTPUT_DIR"
if [[ "$TARGET" == "apk" || "$TARGET" == "both" ]]; then
  cp "${APP_DIR}/android/app/build/outputs/apk/release/app-release.apk" \
    "${OUTPUT_DIR}/xopc-android.apk"
fi
if [[ "$TARGET" == "aab" || "$TARGET" == "both" ]]; then
  cp "${APP_DIR}/android/app/build/outputs/bundle/release/app-release.aab" \
    "${OUTPUT_DIR}/xopc-android.aab"
fi

echo "Android release artifacts:"
find "$OUTPUT_DIR" -maxdepth 1 -type f -print
