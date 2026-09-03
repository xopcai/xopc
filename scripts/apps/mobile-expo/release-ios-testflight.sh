#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="${ROOT}/apps/mobile-expo"
UPLOAD_TO_TESTFLIGHT="${UPLOAD_TO_TESTFLIGHT:-1}"
SKIP_QUALITY="${SKIP_QUALITY:-0}"

usage() {
  cat <<'EOF'
Usage:
  pnpm run mobile:release:ios:testflight

Builds a signed production IPA, validates it, and uploads it to TestFlight.

Required environment variables:
  APP_STORE_CONNECT_API_KEY
  APP_STORE_CONNECT_API_ISSUER
  DEVELOPMENT_TEAM or APPLE_TEAM_ID

Optional environment variables:
  APP_STORE_CONNECT_PRIVATE_KEY_PATH
  IOS_BUILD_NUMBER
  IOS_MARKETING_VERSION
  UPLOAD_TO_TESTFLIGHT=0   build without uploading
  SKIP_QUALITY=1           skip lint, typecheck, and tests
  PREBUILD=0               reuse the generated native project
  CLEAN_PREBUILD=0         do not clean during Expo prebuild
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Error: missing required environment variable: $name" >&2
    usage >&2
    exit 1
  fi
}

run_step() {
  local label="$1"
  shift
  echo "==> $label"
  "$@"
}

API_KEY="${APP_STORE_CONNECT_API_KEY:-}"
API_ISSUER="${APP_STORE_CONNECT_API_ISSUER:-}"
TEAM_ID="${DEVELOPMENT_TEAM:-${APPLE_TEAM_ID:-}}"
PRIVATE_KEY_PATH="${APP_STORE_CONNECT_PRIVATE_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${API_KEY}.p8}"

require_value APP_STORE_CONNECT_API_KEY "$API_KEY"
require_value APP_STORE_CONNECT_API_ISSUER "$API_ISSUER"
require_value "DEVELOPMENT_TEAM or APPLE_TEAM_ID" "$TEAM_ID"

if [[ ! -f "$PRIVATE_KEY_PATH" ]]; then
  echo "Error: App Store Connect private key not found: $PRIVATE_KEY_PATH" >&2
  exit 1
fi

cd "$ROOT"
if [[ "$SKIP_QUALITY" != "1" ]]; then
  run_step "Lint mobile app" pnpm run mobile:lint
  run_step "Typecheck mobile app" pnpm run mobile:typecheck
  run_step "Test mobile app" pnpm run mobile:test
  run_step "Test agent stream client" pnpm run mobile:test:stream
fi

run_step "Build signed iOS IPA" env \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  APP_STORE_CONNECT_PRIVATE_KEY_PATH="$PRIVATE_KEY_PATH" \
  PREBUILD="${PREBUILD:-1}" \
  CLEAN_PREBUILD="${CLEAN_PREBUILD:-1}" \
  pnpm -C "$APP_DIR" run build:ios

BUILT_IPA="${IPA_PATH:-dist/xopc.ipa}"
if [[ "$BUILT_IPA" != /* ]]; then BUILT_IPA="$APP_DIR/$BUILT_IPA"; fi
run_step "Check release metadata, entitlements and privacy manifests" python3 \
  "$ROOT/scripts/apps/mobile-expo/verify-ios-ipa.py" \
  "$BUILT_IPA" \
  --version "${IOS_MARKETING_VERSION:-$(node -p "require('$APP_DIR/app.json').expo.version")}" \
  --report "$APP_DIR/dist/ios/verification.json"

if [[ "$UPLOAD_TO_TESTFLIGHT" == "1" ]]; then
  run_step "Validate and upload IPA to TestFlight" env \
    APP_STORE_CONNECT_PRIVATE_KEY_PATH="$PRIVATE_KEY_PATH" \
    pnpm -C "$APP_DIR" run submit:ios:direct
else
  echo "Upload skipped. IPA: ${APP_DIR}/dist/xopc.ipa"
fi
