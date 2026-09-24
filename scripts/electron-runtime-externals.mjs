import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Runtime modules kept external in the Electron gateway bundle. */
export const ELECTRON_GATEWAY_EXTERNALS = [
  'electron',
  'sharp',
  '@vscode/ripgrep',
  'silk-wasm',
  'playwright-core',
  'fsevents',
];

/** Real node_modules packages required by the packaged gateway/extensions. */
export const ELECTRON_PACKAGED_DEPENDENCIES = [
  'ws',
  'sharp',
  'silk-wasm',
  'node-pty',
  '@trycua/cua-driver',
];

/** Security overrides required by the isolated Electron runtime install. */
export const ELECTRON_PACKAGED_OVERRIDES = {
  'tar@<=7.5.20': '7.5.22',
};

/** @param {string} repoRoot */
export function resolveInstalledElectronVersion(repoRoot) {
  const requireFromRoot = createRequire(join(repoRoot, 'package.json'));
  const pkgPath = requireFromRoot.resolve('electron/package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

/** @param {string} repoRoot @param {string} name */
export function resolveInstalledPackageVersion(repoRoot, name) {
  const directPath = join(repoRoot, 'node_modules', ...name.split('/'), 'package.json');
  if (existsSync(directPath)) {
    return JSON.parse(readFileSync(directPath, 'utf8')).version;
  }
  const requireFromRoot = createRequire(join(repoRoot, 'package.json'));
  const pkgPath = requireFromRoot.resolve(`${name}/package.json`);
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

/**
 * @param {Record<string, unknown>} rootPkg Parsed root package.json
 * @param {string} [repoRoot] When set, pins devDependencies.electron to the installed exact version.
 * @returns {Record<string, unknown>} package.json for electron-builder (minimal dependencies)
 */
export function buildMinimalElectronPackageJson(rootPkg, repoRoot) {
  const dependencies = {};
  for (const name of ELECTRON_PACKAGED_DEPENDENCIES) {
    const version =
      rootPkg.dependencies?.[name] ??
      rootPkg.optionalDependencies?.[name] ??
      rootPkg.devDependencies?.[name];
    if (typeof version === 'string') {
      dependencies[name] = repoRoot != null ? resolveInstalledPackageVersion(repoRoot, name) : version;
    }
  }

  const missing = ELECTRON_PACKAGED_DEPENDENCIES.filter((name) => !(name in dependencies));
  if (missing.length > 0) {
    throw new Error(
      `[electron-runtime-externals] Missing root dependencies for packaged runtime: ${missing.join(', ')}`,
    );
  }

  // Do not carry the published package's optional peers into the isolated Electron
  // install. pnpm auto-installs them, which would duplicate the separately staged
  // playwright-core tree and install the Lark SDK even though Electron extensions
  // are bundled as self-contained modules.
  const {
    dependencies: _dependencies,
    devDependencies: _dev,
    optionalDependencies: _optional,
    peerDependencies: _peers,
    peerDependenciesMeta: _peerMeta,
    ...rest
  } = rootPkg;
  const devDependencies = {};
  if (typeof rootPkg.devDependencies?.electron === 'string') {
    devDependencies.electron =
      repoRoot != null ? resolveInstalledElectronVersion(repoRoot) : rootPkg.devDependencies.electron;
  }

  return {
    ...rest,
    dependencies,
    ...(Object.keys(devDependencies).length > 0 ? { devDependencies } : {}),
  };
}
