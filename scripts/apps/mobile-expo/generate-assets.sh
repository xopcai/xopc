#!/usr/bin/env bash
# Backwards-compatible entry point for the repository-wide xopc brand asset generator.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

exec node "${REPO_ROOT}/scripts/generate-brand-assets.mjs" --target=mobile
