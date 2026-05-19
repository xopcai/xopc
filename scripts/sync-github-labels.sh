#!/usr/bin/env bash
# Sync GitHub issue labels from .github/labels.json (requires gh CLI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABELS_FILE="${ROOT}/.github/labels.json"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required (https://cli.github.com/)" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

if [[ ! -f "${LABELS_FILE}" ]]; then
  echo "error: missing ${LABELS_FILE}" >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [[ -z "${REPO}" ]]; then
  echo "error: not inside a git repo with gh remote, or gh auth missing" >&2
  exit 1
fi

echo "Syncing labels to ${REPO} from ${LABELS_FILE}…"

count=0
while IFS= read -r row; do
  name="$(jq -r '.name' <<<"${row}")"
  color="$(jq -r '.color' <<<"${row}")"
  description="$(jq -r '.description' <<<"${row}")"
  if gh label create "${name}" --repo "${REPO}" --color "${color}" --description "${description}" --force 2>/dev/null; then
    echo "  ✓ ${name}"
  else
    echo "  ✗ ${name}" >&2
    exit 1
  fi
  count=$((count + 1))
done < <(jq -c '.[]' "${LABELS_FILE}")

echo "Done. ${count} labels synced."
