#!/usr/bin/env node
/**
 * Download frpc binaries into electron/resources/frpc/{platform}_{arch}/.
 * Usage:
 *   node scripts/download-frpc-binaries.mjs
 *   node scripts/download-frpc-binaries.mjs --all
 *   node scripts/download-frpc-binaries.mjs --platform darwin --arch arm64
 */
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const FRP_VERSION = '0.62.1';

const PLATFORM_MAP = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const ARCH_MAP = { x64: 'amd64', arm64: 'arm64' };

const ALL_TARGETS = [
  ['darwin', 'amd64'],
  ['darwin', 'arm64'],
  ['linux', 'amd64'],
  ['linux', 'arm64'],
  ['windows', 'amd64'],
];

function parseArgs() {
  const all = process.argv.includes('--all');
  let platform = PLATFORM_MAP[process.platform] ?? process.platform;
  let arch = ARCH_MAP[process.arch] ?? process.arch;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--platform' && process.argv[i + 1]) platform = process.argv[++i];
    if (process.argv[i] === '--arch' && process.argv[i + 1]) arch = process.argv[++i];
  }
  return { targets: all ? ALL_TARGETS : [[platform, arch]] };
}

function extractTarGz(archivePath, destDir, innerPath, destBin) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['xzf', archivePath, '-C', destDir, innerPath, '--strip-components=1'], {
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}`));
    });
  }).then(() => {
    if (existsSync(join(destDir, 'frpc')) && !existsSync(destBin)) {
      copyFileSync(join(destDir, 'frpc'), destBin);
    }
    if (existsSync(join(destDir, 'frpc.exe')) && !existsSync(destBin)) {
      copyFileSync(join(destDir, 'frpc.exe'), destBin);
    }
  });
}

async function downloadOne(platform, arch) {
  const folder = `frp_${FRP_VERSION}_${platform}_${arch}`;
  const url = `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${folder}.tar.gz`;
  const destDir = join('electron', 'resources', 'frpc', `${platform}_${arch}`);
  const ext = platform === 'windows' ? '.exe' : '';
  const destBin = join(destDir, `frpc${ext}`);
  if (existsSync(destBin)) {
    console.log(`skip ${destBin}`);
    return;
  }
  mkdirSync(destDir, { recursive: true });
  const archivePath = join(destDir, '_frpc.tgz');
  console.log(`fetch ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(archivePath));
  const innerPath = `${folder}/frpc${ext}`;
  await extractTarGz(archivePath, destDir, innerPath, destBin);
  if (platform !== 'windows') chmodSync(destBin, 0o755);
  rmSync(archivePath, { force: true });
  console.log(`ok ${destBin}`);
}

const { targets } = parseArgs();
for (const [platform, arch] of targets) {
  await downloadOne(platform, arch);
}
