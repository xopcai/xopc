#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-both}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/mobile-expo"
OUTPUT_DIR="${APP_DIR}/dist/android"
CREDENTIALS_FILE="${ANDROID_CREDENTIALS_FILE:-${APP_DIR}/credentials.json}"

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

read_android_credential() {
  node -e '
    const fs = require("node:fs");
    const credentials = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = credentials?.android?.keystore?.[process.argv[2]];
    if (typeof value === "string") process.stdout.write(value);
  ' "$CREDENTIALS_FILE" "$1"
}

if [[ -f "$CREDENTIALS_FILE" ]]; then
  ANDROID_KEYSTORE_PATH="${ANDROID_KEYSTORE_PATH:-$(read_android_credential keystorePath)}"
  ANDROID_KEYSTORE_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-$(read_android_credential keystorePassword)}"
  ANDROID_KEY_ALIAS="${ANDROID_KEY_ALIAS:-$(read_android_credential keyAlias)}"
  ANDROID_KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-$(read_android_credential keyPassword)}"

  if [[ -n "$ANDROID_KEYSTORE_PATH" && "$ANDROID_KEYSTORE_PATH" != /* ]]; then
    ANDROID_KEYSTORE_PATH="${APP_DIR}/${ANDROID_KEYSTORE_PATH}"
  fi
fi

require_value ANDROID_KEYSTORE_PATH
require_value ANDROID_KEYSTORE_PASSWORD
require_value ANDROID_KEY_ALIAS
require_value ANDROID_KEY_PASSWORD

if [[ ! -f "$ANDROID_KEYSTORE_PATH" ]]; then
  echo "Error: Android keystore not found: $ANDROID_KEYSTORE_PATH" >&2
  exit 1
fi

node "${APP_DIR}/scripts/verify-google-services.mjs"

echo "Generating the Android native project..."
pnpm -C "$APP_DIR" exec expo prebuild --platform android --clean --no-install

export NODE_ENV="${NODE_ENV:-production}"
mkdir -p "${APP_DIR}/android/app/build/intermediates/sourcemaps/react/release"

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

gradle_args=("--stacktrace")
if [[ -n "${ANDROID_GRADLE_JVM_ARGS:-}" ]]; then
  gradle_args+=("-Dorg.gradle.jvmargs=${ANDROID_GRADLE_JVM_ARGS}")
fi
if [[ -n "${ANDROID_GRADLE_MAX_WORKERS:-}" ]]; then
  gradle_args+=("--max-workers=${ANDROID_GRADLE_MAX_WORKERS}")
fi

echo "Building Android release target: $TARGET"
(cd "${APP_DIR}/android" && ./gradlew "${gradle_args[@]}" "${gradle_tasks[@]}")

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
