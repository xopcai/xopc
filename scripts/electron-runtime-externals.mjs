import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Runtime modules kept external in the Electron gateway bundle. */
export const ELECTRON_GATEWAY_EXTERNALS = [
  'electron',
  '@vscode/ripgrep',
  'silk-wasm',
  'playwright-core',
  '@huggingface/transformers',
  'sherpa-onnx-node',
  'fsevents',
];

/** Real node_modules packages required by the packaged gateway/extensions. */
export const ELECTRON_PACKAGED_DEPENDENCIES = [
  'silk-wasm',
  '@huggingface/transformers',
  'onnxruntime-common',
  'sherpa-onnx-node',
];

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
    const version = rootPkg.dependencies?.[name];
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

  const { devDependencies: _dev, ...rest } = rootPkg;
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
