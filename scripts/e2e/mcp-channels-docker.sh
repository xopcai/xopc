#!/usr/bin/env bash
# Smoke test: channel bridge module loads (full gateway e2e requires running gateway + token).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node --import tsx/esm -e "
import { loadMcpServeConfig } from './src/mcp/channel-bridge.js';
const cfg = loadMcpServeConfig();
if (!cfg || typeof cfg !== 'object') process.exit(1);
console.log('mcp-channels-docker: config load OK');
"
echo "mcp-channels-docker: smoke OK"
