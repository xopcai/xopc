#!/usr/bin/env bash
set -euo pipefail

API_KEY="${APP_STORE_CONNECT_API_KEY:-}"
API_ISSUER="${APP_STORE_CONNECT_API_ISSUER:-}"
DIST_DIR="${DIST_DIR:-dist}"
IPA_PATH="${IPA_PATH:-$DIST_DIR/xopc.ipa}"

usage() {
  cat <<EOF
Usage:
  $0 [ipa-download-url-or-local-ipa-path]

Required environment variables:
  APP_STORE_CONNECT_API_KEY       App Store Connect API Key ID
  APP_STORE_CONNECT_API_ISSUER    App Store Connect API Issuer ID

Optional environment variables:
  APP_STORE_CONNECT_PRIVATE_KEY_PATH
                                  default: ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
  IPA_PATH                        default: dist/xopc.ipa
  DIST_DIR                        default: dist
  SKIP_VALIDATE=1                 skip altool validation

Examples:
  $0
  $0 dist/xopc.ipa
  APP_STORE_CONNECT_API_KEY="KEY_ID" APP_STORE_CONNECT_API_ISSUER="ISSUER_ID" $0 "https://expo.dev/artifacts/eas/xxx.ipa"
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/mobile-expo"
cd "$APP_DIR"

IPA_SOURCE="${1:-}"

if [[ -z "$API_KEY" ]]; then
  echo "Error: missing APP_STORE_CONNECT_API_KEY" >&2
  usage >&2
  exit 1
fi

if [[ -z "$API_ISSUER" ]]; then
  echo "Error: missing APP_STORE_CONNECT_API_ISSUER" >&2
  usage >&2
  exit 1
fi

PRIVATE_KEY_PATH="${APP_STORE_CONNECT_PRIVATE_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${API_KEY}.p8}"

if [[ ! -f "$PRIVATE_KEY_PATH" ]]; then
  cat >&2 <<EOF
Error: App Store Connect private key not found:
  $PRIVATE_KEY_PATH

Expected file name:
  AuthKey_${API_KEY}.p8

Put it under:
  ~/.appstoreconnect/private_keys/
EOF
  exit 1
fi

if [[ -n "$IPA_SOURCE" && "$IPA_SOURCE" =~ ^https?:// ]]; then
  mkdir -p "$(dirname "$IPA_PATH")"

  echo "Downloading IPA..."
  echo "  URL: $IPA_SOURCE"
  echo "  Out: $IPA_PATH"
  curl -fL --retry 3 --retry-delay 2 "$IPA_SOURCE" -o "$IPA_PATH"
elif [[ -n "$IPA_SOURCE" ]]; then
  if [[ ! -f "$IPA_SOURCE" ]]; then
    echo "Error: local IPA not found: $IPA_SOURCE" >&2
    exit 1
  fi
  IPA_PATH="$IPA_SOURCE"
  echo "Using local IPA:"
  echo "  $IPA_PATH"
else
  if [[ ! -f "$IPA_PATH" ]]; then
    cat >&2 <<EOF
Error: missing IPA.

Expected local file:
  $IPA_PATH

Or pass an IPA download URL/local file path:
  $0 "https://expo.dev/artifacts/eas/xxx.ipa"
  $0 dist/xopc.ipa
EOF
    exit 1
  fi
  echo "Using local IPA:"
  echo "  $IPA_PATH"
fi

python3 "$SCRIPT_DIR/verify-ios-ipa.py" "$IPA_PATH" \
  --version "${IOS_MARKETING_VERSION:-$(node -p "require('./app.json').expo.version")}" \
  --report "$DIST_DIR/ios/verification.json"

if [[ "${SKIP_VALIDATE:-}" != "1" ]]; then
  echo "Validating IPA with altool..."
  xcrun altool --validate-app -f "$IPA_PATH" -t ios \
    --api-key "$API_KEY" \
    --api-issuer "$API_ISSUER"
fi

echo "Uploading IPA to App Store Connect..."
xcrun altool --upload-app -f "$IPA_PATH" -t ios \
  --api-key "$API_KEY" \
  --api-issuer "$API_ISSUER"

echo "Done. Check processing status in App Store Connect:"
echo "https://appstoreconnect.apple.com/apps/6772332549/testflight/ios"
