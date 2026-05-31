#!/usr/bin/env node
/**
 * Stage an isolated Electron app directory under out/electron-pack/.
 * electron-builder copies from here (directories.app) with beforeBuild=false so only
 * the pre-populated runtime node_modules tree is packaged.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ELECTRON_PACKAGED_DEPENDENCIES,
  buildMinimalElectronPackageJson,
} from './electron-runtime-externals.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = join(root, 'out/electron-pack');

const APP_COPY_PATHS = [
  { from: 'out/main', to: 'out/main' },
  { from: 'out/preload', to: 'out/preload' },
  { from: 'out/server', to: 'out/server' },
  { from: 'dist/gateway/static/root', to: 'dist/gateway/static/root' },
  { from: 'skills', to: 'skills' },
];

function copyDir(from, to) {
  if (!existsSync(from)) {
    throw new Error(`[prepare-electron-pack-dir] Missing ${from}. Run electron:vite:build:package and build:web first.`);
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

function resolvePackageDir(repoRoot, packageName) {
  const segments = packageName.startsWith('@') ? packageName.split('/') : [packageName];
  const direct = join(repoRoot, 'node_modules', ...segments);
  if (existsSync(join(direct, 'package.json'))) {
    return direct;
  }

  const pnpmName = packageName.replace('/', '+');
  const pnpmRoot = join(repoRoot, 'node_modules/.pnpm');
  if (existsSync(pnpmRoot)) {
    for (const entry of readdirSync(pnpmRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(`${pnpmName}@`)) continue;
      const candidate = join(pnpmRoot, entry.name, 'node_modules', ...segments);
      if (existsSync(join(candidate, 'package.json'))) {
        return candidate;
      }
    }
  }

  const requireFromRoot = createRequire(join(repoRoot, 'package.json'));
  let entryPath;
  try {
    entryPath = requireFromRoot.resolve(packageName);
  } catch (err) {
    throw new Error(
      `[prepare-electron-pack-dir] Cannot resolve ${packageName} from root node_modules: ${err instanceof Error ? err.message : err}`,
    );
  }

  let dir = dirname(entryPath);
  while (dir.length >= repoRoot.length) {
    const pkgJsonPath = join(dir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.name === packageName) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`[prepare-electron-pack-dir] Cannot locate package directory for ${packageName}`);
}

/**
 * @param {string} repoRoot
 * @param {string} packageName
 * @param {string} destNodeModules
 * @param {Set<string>} seen
 * @param {Set<string>} [optionalNames]
 */
function copyPackageTree(repoRoot, packageName, destNodeModules, seen, optionalNames = new Set()) {
  const key = packageName;
  if (seen.has(key)) return;
  seen.add(key);

  const pkgDir = resolvePackageDir(repoRoot, packageName);
  const pkgJsonPath = join(pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const segments = packageName.startsWith('@') ? packageName.split('/') : [packageName];
  const dest = join(destNodeModules, ...segments);

  mkdirSync(dirname(dest), { recursive: true });
  cpSync(pkgDir, dest, { recursive: true, dereference: true });

  const childDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  };
  const childOptional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
  for (const depName of Object.keys(childDeps)) {
    try {
      copyPackageTree(repoRoot, depName, destNodeModules, seen, childOptional);
    } catch (err) {
      if (childOptional.has(depName) || optionalNames.has(depName)) {
        console.warn(
          `[prepare-electron-pack-dir] Skipping optional dep ${depName}: ${err instanceof Error ? err.message : err}`,
        );
        continue;
      }
      throw err;
    }
  }
}

function stageRipgrepBinary(repoRoot, packDir) {
  const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;
  const rgName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  let rgPath;
  try {
    const pkgDir = resolvePackageDir(repoRoot, platformPkg);
    const candidate = join(pkgDir, 'bin', rgName);
    if (!existsSync(candidate)) {
      throw new Error(`missing ${candidate}`);
    }
    rgPath = candidate;
  } catch (err) {
    console.warn(
      `[prepare-electron-pack-dir] Ripgrep binary not found for ${platformPkg}: ${err instanceof Error ? err.message : err}`,
    );
    return;
  }

  const destDir = join(packDir, '_pack-resources/rg');
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

  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const minimalPkg = buildMinimalElectronPackageJson(rootPkg, repoRoot);
  writeFileSync(join(packDir, 'package.json'), `${JSON.stringify(minimalPkg, null, 2)}\n`);

  const destNodeModules = join(packDir, 'node_modules');
  mkdirSync(destNodeModules, { recursive: true });
  const seen = new Set();
  for (const name of ELECTRON_PACKAGED_DEPENDENCIES) {
    copyPackageTree(repoRoot, name, destNodeModules, seen);
  }

  stageRipgrepBinary(repoRoot, packDir);

  const entitlementsSrc = join(repoRoot, 'electron/resources/entitlements.mac.plist');
  if (existsSync(entitlementsSrc)) {
    const dest = join(packDir, '_pack-resources/entitlements.mac.plist');
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(entitlementsSrc, dest);
  }

  console.log(
    `[prepare-electron-pack-dir] Staged ${packDir} (${ELECTRON_PACKAGED_DEPENDENCIES.length} runtime deps, ${seen.size} packages)`,
  );
  return packDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  prepareElectronPackDir();
}
