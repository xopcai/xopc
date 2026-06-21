/** Stage the minimal Electron app directory consumed by electron-builder. */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function installRuntimeDeps(packDirPath) {
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
    ],
    { cwd: packDirPath, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if ((r.status ?? 1) !== 0) {
    throw new Error(`[prepare-electron-pack-dir] pnpm install failed in ${packDirPath}`);
  }
}

function stageRipgrepBinary(repoRoot, packDirPath) {
  const rgName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;
  const direct = join(repoRoot, 'node_modules', '@vscode', `ripgrep-${process.platform}-${process.arch}`, 'bin', rgName);
  const pnpmStore = join(repoRoot, 'node_modules', '.pnpm');
  const pnpm = existsSync(pnpmStore)
    ? readdirSync(pnpmStore)
        .filter((name) => name.startsWith(platformPkg.replace('/', '+') + '@'))
        .map((name) => join(pnpmStore, name, 'node_modules', '@vscode', `ripgrep-${process.platform}-${process.arch}`, 'bin', rgName))
        .find((candidate) => existsSync(candidate))
    : undefined;
  const rgPath = existsSync(direct) ? direct : pnpm;
  if (!rgPath) {
    throw new Error(`[prepare-electron-pack-dir] Missing ripgrep binary for ${platformPkg}`);
  }
  const destDir = join(packDirPath, '_pack-resources/rg');
  mkdirSync(destDir, { recursive: true });
  cpSync(rgPath, join(destDir, rgName));
}

export function prepareElectronPackDir(repoRoot = root) {
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });

  for (const { from, to } of APP_COPY_PATHS) copyRequired(repoRoot, from, to);
  for (const { from, to } of PACK_RESOURCE_COPIES) copyRequired(repoRoot, from, to);

  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const minimalPkg = buildMinimalElectronPackageJson(rootPkg, repoRoot);
  writeFileSync(join(packDir, 'package.json'), `${JSON.stringify(minimalPkg, null, 2)}\n`);

  installRuntimeDeps(packDir);
  stageRipgrepBinary(repoRoot, packDir);

  console.log(`[prepare-electron-pack-dir] Staged ${packDir}`);
  return packDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  prepareElectronPackDir();
}
