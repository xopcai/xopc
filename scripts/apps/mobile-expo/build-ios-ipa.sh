#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-xopc}"
DIST_DIR="${DIST_DIR:-dist}"
IOS_SCHEME="${IOS_SCHEME:-$APP_NAME}"
IOS_CONFIGURATION="${IOS_CONFIGURATION:-Release}"
IOS_BUILD_NUMBER="${IOS_BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
IOS_MARKETING_VERSION="${IOS_MARKETING_VERSION:-}"
IOS_WORKSPACE="${IOS_WORKSPACE:-ios/${APP_NAME}.xcworkspace}"
ARCHIVE_PATH="${ARCHIVE_PATH:-$DIST_DIR/ios/archive/${APP_NAME}.xcarchive}"
EXPORT_DIR="${EXPORT_DIR:-$DIST_DIR/ios/export}"
IPA_PATH="${IPA_PATH:-$DIST_DIR/${APP_NAME}.ipa}"
EXPORT_METHOD="${EXPORT_METHOD:-app-store-connect}"
SIGNING_STYLE="${SIGNING_STYLE:-automatic}"
ARCHIVE_SIGNING="${ARCHIVE_SIGNING:-distribution}"
GENERATED_EXPORT_OPTIONS_PLIST="$DIST_DIR/ios/ExportOptions.plist"
EXPORT_OPTIONS_PLIST="${EXPORT_OPTIONS_PLIST:-$GENERATED_EXPORT_OPTIONS_PLIST}"
DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-}"
PREBUILD="${PREBUILD:-1}"
CLEAN_PREBUILD="${CLEAN_PREBUILD:-1}"
ALLOW_PROVISIONING_UPDATES="${ALLOW_PROVISIONING_UPDATES:-1}"
API_KEY="${APP_STORE_CONNECT_API_KEY:-}"
API_ISSUER="${APP_STORE_CONNECT_API_ISSUER:-}"
IOS_PROVISIONING_PROFILE_MAIN="${IOS_PROVISIONING_PROFILE_MAIN:-}"
IOS_PROVISIONING_PROFILE_SHARE="${IOS_PROVISIONING_PROFILE_SHARE:-}"
IOS_PROVISIONING_PROFILE_WIDGET="${IOS_PROVISIONING_PROFILE_WIDGET:-}"

usage() {
  cat <<EOF
Usage:
  $0

Build a local App Store Connect IPA at:
  $IPA_PATH

Required local tools:
  Xcode command line tools, pnpm, CocoaPods

Common environment variables:
  DEVELOPMENT_TEAM                 Apple Developer Team ID for signing
  APP_STORE_CONNECT_API_KEY        Optional API key ID for provisioning updates
  APP_STORE_CONNECT_API_ISSUER     Optional API issuer ID for provisioning updates
  APP_STORE_CONNECT_PRIVATE_KEY_PATH
                                   default: ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8

Optional build variables:
  APP_NAME                         default: xopc
  IOS_SCHEME                       default: xopc
  IOS_CONFIGURATION                default: Release
  IOS_BUILD_NUMBER                 default: current timestamp, e.g. 202606251430
  IOS_MARKETING_VERSION            default: expo.version from app.json
  IOS_WORKSPACE                    default: ios/xopc.xcworkspace
  DIST_DIR                         default: dist
  IPA_PATH                         default: dist/xopc.ipa
  ARCHIVE_PATH                     default: dist/ios/archive/xopc.xcarchive
  EXPORT_DIR                       default: dist/ios/export
  EXPORT_METHOD                    default: app-store-connect
  SIGNING_STYLE                    default: automatic
  ARCHIVE_SIGNING                  default: distribution; automatic|distribution
  IOS_PROVISIONING_PROFILE_MAIN    main app profile UUID/name for manual signing
  IOS_PROVISIONING_PROFILE_SHARE   ShareIntake profile UUID/name for manual signing
  IOS_PROVISIONING_PROFILE_WIDGET  widget profile UUID/name for manual signing
  EXPORT_OPTIONS_PLIST             default: generated under dist/ios/
  PREBUILD=auto|1|0                default: 1; regenerate the native project
  CLEAN_PREBUILD=0                 preserve the native project during prebuild
  ALLOW_PROVISIONING_UPDATES=0     disable xcodebuild -allowProvisioningUpdates

Examples:
  DEVELOPMENT_TEAM="TEAMID1234" pnpm -C apps/mobile-expo run build:ios
  pnpm -C apps/mobile-expo run submit:ios:direct
EOF
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: missing required command: $1" >&2
    exit 1
  fi
}

add_xcodebuild_common_args() {
  if is_truthy "$ALLOW_PROVISIONING_UPDATES"; then
    XCODEBUILD_ARGS+=("-allowProvisioningUpdates")
  fi

  if [[ -n "$API_KEY" || -n "$API_ISSUER" ]]; then
    if [[ -z "$API_KEY" || -z "$API_ISSUER" ]]; then
      echo "Error: APP_STORE_CONNECT_API_KEY and APP_STORE_CONNECT_API_ISSUER must be set together" >&2
      exit 1
    fi

    local private_key_path="${APP_STORE_CONNECT_PRIVATE_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${API_KEY}.p8}"
    if [[ ! -f "$private_key_path" ]]; then
      cat >&2 <<EOF
Error: App Store Connect private key not found:
  $private_key_path

Expected file name:
  AuthKey_${API_KEY}.p8

Put it under:
  ~/.appstoreconnect/private_keys/
EOF
      exit 1
    fi

    XCODEBUILD_ARGS+=(
      "-authenticationKeyPath" "$private_key_path"
      "-authenticationKeyID" "$API_KEY"
      "-authenticationKeyIssuerID" "$API_ISSUER"
    )
  fi
}

write_export_options_plist() {
  mkdir -p "$(dirname "$EXPORT_OPTIONS_PLIST")"
  cat > "$EXPORT_OPTIONS_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>$EXPORT_METHOD</string>
  <key>signingStyle</key>
  <string>$SIGNING_STYLE</string>
  <key>stripSwiftSymbols</key>
  <true/>
EOF

  if [[ -n "$DEVELOPMENT_TEAM" ]]; then
    cat >> "$EXPORT_OPTIONS_PLIST" <<EOF
  <key>teamID</key>
  <string>$DEVELOPMENT_TEAM</string>
EOF
  fi

  if [[ "$SIGNING_STYLE" == "manual" ]]; then
    if [[ -z "$IOS_PROVISIONING_PROFILE_MAIN" || -z "$IOS_PROVISIONING_PROFILE_SHARE" || -z "$IOS_PROVISIONING_PROFILE_WIDGET" ]]; then
      echo "Error: all IOS_PROVISIONING_PROFILE_* values are required for manual signing" >&2
      exit 1
    fi
    cat >> "$EXPORT_OPTIONS_PLIST" <<EOF
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>ai.xopc.xopc</key>
    <string>$IOS_PROVISIONING_PROFILE_MAIN</string>
    <key>ai.xopc.xopc.ShareIntake</key>
    <string>$IOS_PROVISIONING_PROFILE_SHARE</string>
    <key>ai.xopc.xopc.ExpoWidgetsTarget</key>
    <string>$IOS_PROVISIONING_PROFILE_WIDGET</string>
  </dict>
EOF
  fi

  cat >> "$EXPORT_OPTIONS_PLIST" <<EOF
</dict>
</plist>
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_command pnpm
require_command xcodebuild
require_command xcrun

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/mobile-expo"
cd "$APP_DIR"

if [[ -z "$IOS_MARKETING_VERSION" ]]; then
  IOS_MARKETING_VERSION="$(node -e "process.stdout.write(require('./app.json').expo.version)")"
fi
if [[ ! "$IOS_MARKETING_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: IOS_MARKETING_VERSION must use x.y.z format: $IOS_MARKETING_VERSION" >&2
  exit 1
fi
if [[ ! "$IOS_BUILD_NUMBER" =~ ^[0-9]+([.][0-9]+){0,2}$ ]]; then
  echo "Error: IOS_BUILD_NUMBER must contain one to three dot-separated integers: $IOS_BUILD_NUMBER" >&2
  exit 1
fi

if [[ "$PREBUILD" == "1" || ( "$PREBUILD" == "auto" && ! -d "$IOS_WORKSPACE" ) ]]; then
  echo "Preparing iOS native project..."
  prebuild_args=(exec expo prebuild --platform ios --no-install)
  if is_truthy "$CLEAN_PREBUILD"; then
    prebuild_args+=(--clean)
  fi
  pnpm -C "$APP_DIR" "${prebuild_args[@]}"
elif [[ "$PREBUILD" != "0" && "$PREBUILD" != "auto" ]]; then
  echo "Error: PREBUILD must be auto, 1, or 0" >&2
  exit 1
fi

if [[ -f ios/Podfile ]]; then
  pnpm run pods:install
fi

if [[ ! -d "$IOS_WORKSPACE" ]]; then
  cat >&2 <<EOF
Error: iOS workspace not found after prebuild and pod install:
  $IOS_WORKSPACE

Run:
  pnpm -C apps/mobile-expo exec expo prebuild --platform ios
  pnpm -C apps/mobile-expo run pods:install
EOF
  exit 1
fi

if [[ "$EXPORT_OPTIONS_PLIST" == "$GENERATED_EXPORT_OPTIONS_PLIST" || ! -f "$EXPORT_OPTIONS_PLIST" ]]; then
  write_export_options_plist
elif [[ ! -f "$EXPORT_OPTIONS_PLIST" ]]; then
  echo "Error: EXPORT_OPTIONS_PLIST not found: $EXPORT_OPTIONS_PLIST" >&2
  exit 1
fi

rm -rf "$ARCHIVE_PATH" "$EXPORT_DIR"
mkdir -p "$(dirname "$ARCHIVE_PATH")" "$EXPORT_DIR" "$(dirname "$IPA_PATH")"

echo "Archiving iOS app..."
echo "  Marketing version: $IOS_MARKETING_VERSION"
echo "  Build number: $IOS_BUILD_NUMBER"
XCODEBUILD_ARGS=(
  "-workspace" "$IOS_WORKSPACE"
  "-scheme" "$IOS_SCHEME"
  "-configuration" "$IOS_CONFIGURATION"
  "-destination" "generic/platform=iOS"
  "-archivePath" "$ARCHIVE_PATH"
  "clean"
  "archive"
  "MARKETING_VERSION=$IOS_MARKETING_VERSION"
  "CURRENT_PROJECT_VERSION=$IOS_BUILD_NUMBER"
)
add_xcodebuild_common_args
case "$ARCHIVE_SIGNING" in
  automatic)
    ;;
  distribution)
    XCODEBUILD_ARGS+=("CODE_SIGN_IDENTITY=Apple Distribution")
    ;;
  *)
    echo "Error: ARCHIVE_SIGNING must be automatic or distribution" >&2
    exit 1
    ;;
esac
if [[ -n "$DEVELOPMENT_TEAM" ]]; then
  XCODEBUILD_ARGS+=("DEVELOPMENT_TEAM=$DEVELOPMENT_TEAM")
fi
xcodebuild "${XCODEBUILD_ARGS[@]}"

echo "Exporting IPA..."
XCODEBUILD_ARGS=(
  "-exportArchive"
  "-archivePath" "$ARCHIVE_PATH"
  "-exportPath" "$EXPORT_DIR"
  "-exportOptionsPlist" "$EXPORT_OPTIONS_PLIST"
)
add_xcodebuild_common_args
xcodebuild "${XCODEBUILD_ARGS[@]}"

FOUND_IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' -print -quit)"
if [[ -z "$FOUND_IPA" ]]; then
  echo "Error: no IPA produced under $EXPORT_DIR" >&2
  exit 1
fi

if [[ "$FOUND_IPA" != "$IPA_PATH" ]]; then
  cp "$FOUND_IPA" "$IPA_PATH"
fi

echo "Done. IPA:"
echo "  $IPA_PATH"
