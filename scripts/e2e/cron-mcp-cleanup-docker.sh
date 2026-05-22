#!/usr/bin/env bash
# Smoke test: cron executor imports MCP retire helper (isolated job cleanup wiring).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node --import tsx/esm -e "
import { retireSessionMcpRuntimeForSessionKey } from './src/agent/mcp/bundle-mcp-tools.js';
await retireSessionMcpRuntimeForSessionKey({ sessionKey: 'cron:test', reason: 'e2e-smoke' });
console.log('cron-mcp-cleanup-docker: retire helper OK');
"
echo "cron-mcp-cleanup-docker: smoke OK"
