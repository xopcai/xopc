#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/xopc-recording-tests.XXXXXX")"
trap 'rm -rf "$test_directory"' EXIT
module_directory="$repo_root/apps/mobile-expo/modules/xopc-voice"

swiftc "$module_directory/ios/RecordingSpool.swift" \
  "$module_directory/tests/RecordingSpoolTests.swift" \
  -o "$test_directory/recording-tests"
"$test_directory/recording-tests"
xcrun --sdk iphoneos swiftc -typecheck -target arm64-apple-ios16.4 \
  -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" \
  "$module_directory/ios/RecordingSpool.swift" \
  "$module_directory/ios/RecordingCapture.swift"
