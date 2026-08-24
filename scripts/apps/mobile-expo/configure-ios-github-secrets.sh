#!/usr/bin/env bash
set -euo pipefail

CREDENTIALS_JSON="${CREDENTIALS_JSON:-apps/mobile-expo/credentials.json}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: missing required command: $1" >&2
    exit 1
  fi
}

credential_field() {
  local target="$1"
  local field="$2"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const [file, targetName, fieldName] = process.argv.slice(1);
    const root = path.dirname(path.resolve(file));
    const ios = JSON.parse(fs.readFileSync(file, "utf8")).ios;
    const target = ios?.distributionCertificate
      ? (targetName === "xopc" ? ios : undefined)
      : ios?.[targetName];
    if (!target) process.exit(2);
    const value = fieldName === "certificatePath"
      ? target.distributionCertificate?.path
      : fieldName === "certificatePassword"
        ? target.distributionCertificate?.password
        : target.provisioningProfilePath;
    if (!value) process.exit(3);
    process.stdout.write(fieldName.endsWith("Path") || fieldName === "profilePath"
      ? path.resolve(root, value)
      : String(value));
  ' "$CREDENTIALS_JSON" "$target" "$field"
}

set_file_secret() {
  local secret_name="$1"
  local file_path="$2"
  if [[ ! -s "$file_path" ]]; then
    echo "Error: signing asset not found: $file_path" >&2
    exit 1
  fi
  base64 < "$file_path" | tr -d '\n' | gh secret set "$secret_name"
}

validate_profile() {
  local profile_path="$1"
  local bundle_id="$2"
  local plist_path
  plist_path="$(mktemp)"
  security cms -D -i "$profile_path" > "$plist_path"
  local application_identifier
  application_identifier="$(plutil -extract Entitlements.application-identifier raw -o - "$plist_path")"
  rm -f "$plist_path"
  if [[ "$application_identifier" != *".$bundle_id" ]]; then
    echo "Error: provisioning profile does not match $bundle_id" >&2
    exit 1
  fi
}

require_command gh
require_command node
require_command security
require_command plutil
if [[ ! -f "$CREDENTIALS_JSON" ]]; then
  echo "Error: $CREDENTIALS_JSON not found. Download all iOS credentials from EAS first." >&2
  exit 1
fi
gh auth status >/dev/null

certificate_path="$(credential_field xopc certificatePath)" || {
  echo "Error: main target credentials are missing from $CREDENTIALS_JSON" >&2
  exit 1
}
main_profile="$(credential_field xopc profilePath)"
share_profile="$(credential_field ShareIntake profilePath)" || {
  echo "Error: ShareIntake credentials are missing. Configure all production iOS targets in EAS first." >&2
  exit 1
}
widget_profile="$(credential_field ExpoWidgetsTarget profilePath)" || {
  echo "Error: ExpoWidgetsTarget credentials are missing. Configure all production iOS targets in EAS first." >&2
  exit 1
}

validate_profile "$main_profile" ai.xopc.xopc
validate_profile "$share_profile" ai.xopc.xopc.ShareIntake
validate_profile "$widget_profile" ai.xopc.xopc.ExpoWidgetsTarget

echo "Uploading encrypted iOS signing assets to GitHub Actions..."
set_file_secret IOS_DISTRIBUTION_CERTIFICATE_BASE64 "$certificate_path"
credential_field xopc certificatePassword | gh secret set IOS_DISTRIBUTION_CERTIFICATE_PASSWORD
set_file_secret IOS_PROVISIONING_PROFILE_MAIN_BASE64 "$main_profile"
set_file_secret IOS_PROVISIONING_PROFILE_SHARE_BASE64 "$share_profile"
set_file_secret IOS_PROVISIONING_PROFILE_WIDGET_BASE64 "$widget_profile"

echo "Done. GitHub Actions now has the distribution certificate and all three provisioning profiles."
