#!/usr/bin/env bash
# Retry transient download and notarization failures in CI; keep build errors fatal.
set -euo pipefail

max_attempts=3
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  if node scripts/electron-builder.mjs "$@" 2>&1 | tee "$log_file"; then
    exit 0
  else
    build_status=${PIPESTATUS[0]}
  fi

  # A failed log pipe must not turn a successful builder exit into a successful job.
  if (( build_status == 0 )); then
    exit 1
  fi
  if ! grep -Eqi 'The server aborted pending request|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|503 Slow Down|code: serviceUnavailable' "$log_file"; then
    exit "$build_status"
  fi
  if (( attempt == max_attempts )); then
    echo "Electron packaging failed after ${max_attempts} attempts."
    exit "$build_status"
  fi

  delay_seconds=$((attempt * 30))
  echo "Transient Electron packaging failure; retrying in ${delay_seconds}s (attempt ${attempt}/${max_attempts})."
  sleep "$delay_seconds"
done
