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
import { chmodSync, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  buildFrpcReleaseBasename,
  FRPC_VERSION,
  frpcDownloadUrlsForTarget,
} from '../src/tunnel/frpc-binary.ts';
import {
  extractFrpcFromReleaseArchive,
  frpcReleaseArchiveExtension,
  nodePlatformForFrpTarget,
} from '../src/tunnel/frpc-extract.ts';

const ALL_TARGETS = [
  ['darwin', 'amd64'],
  ['darwin', 'arm64'],
  ['linux', 'amd64'],
  ['linux', 'arm64'],
  ['windows', 'amd64'],
];

function resolveStateBinDir() {
  const stateDir = process.env.XOPC_STATE_DIR?.trim() || join(homedir(), '.xopc');
  return join(stateDir, 'bin');
}

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

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(destPath));
}

async function downloadOne(platform, arch) {
  const folder = buildFrpcReleaseBasename(platform, arch);
  const urls = frpcDownloadUrlsForTarget(platform, arch, FRPC_VERSION);
  const destDir = resolveStateBinDir();
  const ext = platform === 'windows' ? '.exe' : '';
  const destBin = join(destDir, `frpc${ext}`);
  if (existsSync(destBin)) {
    console.log(`skip ${destBin}`);
    return;
  }
  mkdirSync(destDir, { recursive: true });
  const archiveExt = frpcReleaseArchiveExtension(platform);
  const archivePath = join(destDir, `_frpc-${platform}-${arch}${archiveExt}`);
  let lastErr;
  for (const url of urls) {
    try {
      console.log(`fetch ${url}`);
      await downloadToFile(url, archivePath);
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  await extractFrpcFromReleaseArchive(
    archivePath,
    destBin,
    folder,
    nodePlatformForFrpTarget(platform),
  );
  if (platform !== 'windows') chmodSync(destBin, 0o755);
  rmSync(archivePath, { force: true });
  console.log(`ok ${destBin}`);
}

const { targets } = parseArgs();
for (const [platform, arch] of targets) {
  await downloadOne(platform, arch);
}
