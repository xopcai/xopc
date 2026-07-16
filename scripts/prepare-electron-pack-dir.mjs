/** Stage the minimal Electron app directory consumed by electron-builder. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMinimalElectronPackageJson } from './electron-runtime-externals.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = join(tmpdir(), 'xopc-electron-pack');

const APP_COPY_PATHS = [
  { from: 'out/main', to: 'out/main' },
  { from: 'out/preload', to: 'out/preload' },
  { from: 'out/server', to: 'out/server' },
  { from: 'dist/electron/extensions', to: 'dist/electron/extensions' },
  { from: 'dist/gateway/static/root', to: 'dist/gateway/static/root' },
  { from: 'skills', to: 'skills' },
];

const PACK_RESOURCE_COPIES = [
  { from: 'electron/resources/entitlements.mac.plist', to: '_pack-resources/entitlements.mac.plist' },
  { from: 'scripts/electron-before-build.cjs', to: '_pack-resources/electron-before-build.cjs' },
  { from: 'electron/resources', to: '_pack-resources/build-resources' },
  { from: 'node_modules/playwright-core', to: '_pack-resources/playwright-core' },
  { from: 'dist/browser-ext', to: '_pack-resources/browser-ext' },
];

function copyRequired(repoRoot, from, to) {
  const src = join(repoRoot, from);
  if (!existsSync(src)) {
    throw new Error(`[prepare-electron-pack-dir] Missing ${src}. Build prerequisites not met.`);
  }
  const dest = join(packDir, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, dereference: true });
}

function installRuntimeDeps(packDirPath, target) {
  const r = spawnSync(
    'pnpm',
    [
      'install',
      '--ignore-workspace',
      '--prod',
      '--node-linker=hoisted',
      '--no-frozen-lockfile',
      '--ignore-scripts',
      '--prefer-offline',
      `--cpu=${target.arch}`,
      `--os=${target.platform}`,
    ],
    { cwd: packDirPath, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if ((r.status ?? 1) !== 0) {
    throw new Error(`[prepare-electron-pack-dir] pnpm install failed in ${packDirPath}`);
  }
}

function stageRipgrepBinary(packDirPath, target) {
  const { platform, arch } = target;
  const rgName = platform === 'win32' ? 'rg.exe' : 'rg';
  const platformPkg = `@vscode/ripgrep-${platform}-${arch}`;
  const rgPath = join(packDirPath, 'node_modules', '@vscode', `ripgrep-${platform}-${arch}`, 'bin', rgName);
  if (!existsSync(rgPath)) {
    throw new Error(`[prepare-electron-pack-dir] Missing ripgrep binary for ${platformPkg}`);
  }
  const destDir = join(packDirPath, '_pack-resources/rg');
  mkdirSync(destDir, { recursive: true });
  cpSync(rgPath, join(destDir, rgName));
}

function stageCodebaseMemoryBinary(repoRoot, packDirPath, target) {
  const cbmName = target.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
  const cbmPath = join(repoRoot, 'node_modules', 'codebase-memory-mcp', 'bin', cbmName);
  if (!existsSync(cbmPath)) {
    throw new Error(
      `[prepare-electron-pack-dir] Missing codebase-memory-mcp binary for ${target.platform}/${target.arch}`,
    );
  }
  const destDir = join(packDirPath, '_pack-resources', 'cbm');
  mkdirSync(destDir, { recursive: true });
  cpSync(cbmPath, join(destDir, cbmName));
  const cbmPackage = JSON.parse(
    readFileSync(join(repoRoot, 'node_modules', 'codebase-memory-mcp', 'package.json'), 'utf8'),
  );
  const binarySha256 = createHash('sha256').update(readFileSync(cbmPath)).digest('hex');
  writeFileSync(
    join(destDir, 'codebase-memory-mcp.manifest.json'),
    `${JSON.stringify({
      cbmVersion: cbmPackage.version,
      platform: target.platform === 'win32' ? 'windows' : target.platform,
      arch: target.arch === 'x64' ? 'amd64' : target.arch,
      binarySha256,
    }, null, 2)}\n`,
  );
}

export function prepareElectronPackDir(
  repoRoot = root,
  target = { platform: process.platform, arch: process.arch },
) {
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });

  for (const { from, to } of APP_COPY_PATHS) copyRequired(repoRoot, from, to);
  for (const { from, to } of PACK_RESOURCE_COPIES) copyRequired(repoRoot, from, to);

  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const minimalPkg = buildMinimalElectronPackageJson(rootPkg, repoRoot);
  const ripgrepVersion = rootPkg.dependencies?.['@vscode/ripgrep'];
  if (typeof ripgrepVersion !== 'string') {
    throw new Error('[prepare-electron-pack-dir] Missing @vscode/ripgrep dependency');
  }
  const ripgrepPlatformPackage = `@vscode/ripgrep-${target.platform}-${target.arch}`;
  minimalPkg.dependencies[ripgrepPlatformPackage] = ripgrepVersion;
  writeFileSync(join(packDir, 'package.json'), `${JSON.stringify(minimalPkg, null, 2)}\n`);

  installRuntimeDeps(packDir, target);
  stageRipgrepBinary(packDir, target);
  stageCodebaseMemoryBinary(repoRoot, packDir, target);
  rmSync(join(packDir, 'node_modules', '@vscode', `ripgrep-${target.platform}-${target.arch}`), {
    recursive: true,
    force: true,
  });
  delete minimalPkg.dependencies[ripgrepPlatformPackage];
  writeFileSync(join(packDir, 'package.json'), `${JSON.stringify(minimalPkg, null, 2)}\n`);

  console.log(`[prepare-electron-pack-dir] Staged ${packDir}`);
  return packDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  prepareElectronPackDir();
}
