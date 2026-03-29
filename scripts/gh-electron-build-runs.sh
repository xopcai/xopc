#!/usr/bin/env bash
# List recent Electron Build workflow runs and show how to open failed logs.
# Requires: `gh auth login` and repo default (or run from repo root).
#
# Usage:
#   ./scripts/gh-electron-build-runs.sh
#   ./scripts/gh-electron-build-runs.sh xopcai/xopcbot
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "Install GitHub CLI: https://cli.github.com/"
  exit 1
fi

if [[ "${1:-}" != "" ]]; then
  gh repo set-default "$1" 2>/dev/null || true
fi

echo "=== Workflows matching 'electron' ==="
gh workflow list 2>/dev/null | grep -i electron || gh workflow list | head -20

echo ""
echo "=== Recent Electron Build runs ==="
gh run list --workflow=electron-build.yml --limit 20 2>/dev/null || {
  echo "Run from the repository directory or set: gh repo set-default <owner>/<repo>"
  exit 1
}

echo ""
echo "=== Failed runs (if any) ==="
gh run list --workflow=electron-build.yml --limit 30 --json databaseId,conclusion,displayTitle,url \
  --jq '.[] | select(.conclusion=="failure") | "\(.databaseId) \(.displayTitle) \(.url)"' 2>/dev/null || true

echo ""
echo "View a run:        gh run view <run-id>"
echo "Failed logs only:  gh run view <run-id> --log-failed"
echo "Job logs:          gh run view <run-id> --job <job-name> --log"
