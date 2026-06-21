/**
 * Stage an isolated Electron app directory in os.tmpdir().
 * electron-builder copies from this dir (--project) with beforeBuild=false so only the
 * pre-populated runtime node_modules tree is packaged.
 *
 * Pack dir is OUTSIDE the repo on purpose: when it's a child of the repo, `pnpm
 * --workspace-root exec pwd` (run by electron-builder) walks up and finds the monorepo's
 * pnpm-workspace.yaml, then collects the full workspace node_modules (~200MB+) into the
 * asar. A pack dir under os.tmpdir() has no parent workspace marker, so the collector
 * stops at appDir and only ships our minimal runtime deps.
 *
 * Layout:
 *   out/{main,preload,server}      app code (+ schema.sql, migrations/, workspace-templates/)
 *   dist/{src,extensions,_virtual} bundled extension modules + sibling core/rolldown runtime imports
 *   dist/package.js                 emitted package-version helper imported by dist/src/package-version.js
 *   dist/gateway/static/root       gateway-served UI
 *   skills/                        bundled SKILL.md files
 *   package.json                   minimal package with runtime externals only
 *   pnpm-lock.yaml + node_modules  produced by `pnpm install --ignore-workspace --prod`
 *   _pack-resources/               build-time inputs that aren't part of the app source:
 *     entitlements.mac.plist       macOS entitlements
 *     electron-before-build.cjs    no-op hook (skips electron-builder npmRebuild path)
 *     build-resources/             directories.buildResources (icon.png, .icns, etc.)
 *     rg/                          platform-specific ripgrep binary
 *     playwright-core/             Playwright JS package (chromium binaries are downloaded at runtime)
 *     browser-ext/                 Chrome extension bridge (sideload copy source)
 */
import { spawnSync } from 'node:child_process';
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
  { from: 'dist/src', to: 'dist/src' },
  { from: 'dist/extensions', to: 'dist/extensions' },
  { from: 'dist/_virtual', to: 'dist/_virtual' },
  { from: 'dist/package.js', to: 'dist/package.js' },
  { from: 'dist/gateway/static/root', to: 'dist/gateway/static/root' },
  { from: 'skills', to: 'skills' },
];

/** Build inputs referenced by electron-builder.pack.yml via `_pack-resources/...`. */
const PACK_RESOURCE_COPIES = [
  // Source path (relative to repo root) to destination (relative to pack dir).
  // Required: missing source aborts the build.
  { from: 'electron/resources/entitlements.mac.plist', to: '_pack-resources/entitlements.mac.plist', required: true },
  { from: 'scripts/electron-before-build.cjs', to: '_pack-resources/electron-before-build.cjs', required: true },
  { from: 'electron/resources', to: '_pack-resources/build-resources', required: true },
  { from: 'node_modules/playwright-core', to: '_pack-resources/playwright-core', required: true },
  { from: 'dist/browser-ext', to: '_pack-resources/browser-ext', required: true },
];

function copyDir(from, to) {
  if (!existsSync(from)) {
    throw new Error(
      `[prepare-electron-pack-dir] Missing ${from}. Run electron:vite:build:package and build:web first.`,
    );
  }
  mkdirSync(dirname(to), { recursive: true });
  // Dereference pnpm junctions (Windows) so extraResources copies real files, not store paths.
  cpSync(from, to, { recursive: true, dereference: true });
}

/**
 * --ignore-workspace:    pretend the monorepo doesn't exist (no parent pnpm-workspace.yaml)
 * --prod:                skip devDependencies
 * --node-linker=hoisted: top-level node_modules so platform binaries resolve at known paths
 *                        (e.g. node_modules/@vscode/ripgrep-darwin-arm64/bin/rg)
 * --no-frozen-lockfile:  pack dir starts empty; pnpm generates the lockfile
 * --ignore-scripts:      skip postinstalls; @vscode/ripgrep's binary download is replaced by
 *                        stageRipgrepBinary copying from the global pnpm store
 * --prefer-offline:      reuse the global pnpm content-addressable store (sub-second install)
 */
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

function stageRipgrepBinary(packDirPath) {
  const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;
  const rgName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const rgPath = join(
    packDirPath,
    'node_modules',
    '@vscode',
    `ripgrep-${process.platform}-${process.arch}`,
    'bin',
    rgName,
  );
  if (!existsSync(rgPath)) {
    console.warn(
      `[prepare-electron-pack-dir] Ripgrep binary not found at ${rgPath} (platformPkg=${platformPkg}); ` +
        'extraResources rg/ will be empty.',
    );
    return;
  }
  const destDir = join(packDirPath, '_pack-resources/rg');
  mkdirSync(destDir, { recursive: true });
  cpSync(rgPath, join(destDir, rgName));
}

export function prepareElectronPackDir(repoRoot = root) {
  if (existsSync(packDir)) {
    rmSync(packDir, { recursive: true, force: true });
  }
  mkdirSync(packDir, { recursive: true });

  for (const { from, to } of APP_COPY_PATHS) {
    copyDir(join(repoRoot, from), join(packDir, to));
  }

  for (const { from, to, required } of PACK_RESOURCE_COPIES) {
    const src = join(repoRoot, from);
    if (!existsSync(src)) {
      if (required) {
        throw new Error(`[prepare-electron-pack-dir] Missing ${src}. Build prerequisites not met.`);
      }
      continue;
    }
    const dest = join(packDir, to);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, dereference: true });
  }

  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const minimalPkg = buildMinimalElectronPackageJson(rootPkg, repoRoot);
  writeFileSync(join(packDir, 'package.json'), `${JSON.stringify(minimalPkg, null, 2)}\n`);

  installRuntimeDeps(packDir);
  stageRipgrepBinary(packDir);

  console.log(`[prepare-electron-pack-dir] Staged ${packDir}`);
  return packDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  prepareElectronPackDir();
}
