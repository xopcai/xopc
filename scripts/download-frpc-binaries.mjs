#!/usr/bin/env node
/**
 * Prefetch frpc into the xopc state bin directory (~/.xopc/bin by default).
 * Optional — tunnel start downloads on demand if missing.
 *
 * Usage:
 *   node --import tsx/esm scripts/download-frpc-binaries.mjs
 *   node --import tsx/esm scripts/download-frpc-binaries.mjs --all
 *   node --import tsx/esm scripts/download-frpc-binaries.mjs --platform darwin --arch arm64
 *
 * Env: XOPC_STATE_DIR overrides ~/.xopc
 */
import { ensureFrpcBinary } from '../src/tunnel/frpc-binary.ts';
import { FRPC_RELEASES } from '../src/tunnel/frpc-release.ts';
const ALL_TARGETS = Object.keys(FRPC_RELEASES).map((target) => target.split('_'));

function parseArgs() {
  const all = process.argv.includes('--all');
  let platform = process.platform === 'win32' ? 'windows' : process.platform;
  let arch = process.arch === 'x64' ? 'amd64' : process.arch;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--platform' && process.argv[i + 1]) platform = process.argv[++i];
    if (process.argv[i] === '--arch' && process.argv[i + 1]) arch = process.argv[++i];
  }
  return { targets: all ? ALL_TARGETS : [[platform, arch]] };
}

for (const [platform, arch] of parseArgs().targets) {
  console.log(await ensureFrpcBinary({ platform, arch }));
}
