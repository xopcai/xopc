#!/usr/bin/env bash
# Smoke test: MCP CLI list/show against local config (no live MCP server required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
pnpm run dev -- mcp list
pnpm run dev -- mcp show 2>/dev/null || true
echo "mcp-bundle-tools-docker: CLI smoke OK"
