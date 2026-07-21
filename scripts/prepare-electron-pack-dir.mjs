/** Stage the minimal Electron app directory consumed by electron-builder. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

function removeDirectoryChildrenExcept(dir, keep) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (!keep.has(entry)) rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

/** Remove runtime files that cannot be used by the target Electron build. */
export function pruneElectronRuntimeDeps(packDirPath, target) {
  const onnxTargetDir = join(
    packDirPath,
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v3',
    target.platform,
    target.arch,
  );
  if (!existsSync(onnxTargetDir)) {
    throw new Error(
      `[prepare-electron-pack-dir] Missing ONNX Runtime binaries for ${target.platform}/${target.arch}`,
    );
  }
  const onnxPlatformsDir = join(packDirPath, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
  removeDirectoryChildrenExcept(onnxPlatformsDir, new Set([target.platform]));
  removeDirectoryChildrenExcept(join(onnxPlatformsDir, target.platform), new Set([target.arch]));

  const transformersDir = join(packDirPath, 'node_modules', '@huggingface', 'transformers');
  const transformersPkgPath = join(transformersDir, 'package.json');
  if (!existsSync(transformersPkgPath)) {
    throw new Error('[prepare-electron-pack-dir] Missing @huggingface/transformers runtime dependency');
  }
  const transformersPkg = JSON.parse(readFileSync(transformersPkgPath, 'utf8'));
  delete transformersPkg.dependencies?.['onnxruntime-web'];
  writeFileSync(transformersPkgPath, `${JSON.stringify(transformersPkg, null, 2)}\n`);

  rmSync(join(packDirPath, 'node_modules', 'onnxruntime-web'), { recursive: true, force: true });
  rmSync(join(transformersDir, 'src'), { recursive: true, force: true });
  rmSync(join(transformersDir, 'types'), { recursive: true, force: true });
  removeDirectoryChildrenExcept(
    join(transformersDir, 'dist'),
    new Set(['transformers.node.mjs', 'transformers.node.cjs']),
  );
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

function stageVoiceHotkeyHelper(repoRoot, packDirPath, target) {
  const destDir = join(packDirPath, '_pack-resources', 'voice-hotkey');
  mkdirSync(destDir, { recursive: true });
  if (target.platform !== 'darwin' && target.platform !== 'win32') return;
  const name = target.platform === 'win32' ? 'voice-hotkey-helper.exe' : 'voice-hotkey-helper';
  const source = join(repoRoot, 'dist', 'electron', 'native', name);
  if (!existsSync(source)) {
    throw new Error(`[prepare-electron-pack-dir] Missing native voice hotkey helper: ${source}`);
  }
  cpSync(source, join(destDir, name));
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
  pruneElectronRuntimeDeps(packDir, target);
  stageRipgrepBinary(packDir, target);
  stageCodebaseMemoryBinary(repoRoot, packDir, target);
  stageVoiceHotkeyHelper(repoRoot, packDir, target);
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
