import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Runtime modules kept external in the Electron gateway bundle (`out/server/index.js`)
 * and copied into the packaged app via electron-builder production `dependencies`.
 *
 * Keep in sync with `scripts/build-electron-server.mjs` `external` list. Modules served
 * from `extraResources` (playwright-core, rg binary) or bundled in main/preload are omitted.
 */
export const ELECTRON_GATEWAY_EXTERNALS = [
  'electron',
  '@vscode/ripgrep',
  'silk-wasm',
  'playwright-core',
  'node-cron',
  'fsevents',
];

/**
 * Production deps electron-builder should copy into the packaged app.
 *
 * This includes gateway bundle externals plus deps used by dynamically loaded bundled
 * channel extensions under `dist/extensions/**`. Those extension modules live in
 * `app.asar.unpacked`, and native ESM resolution does not honor NODE_PATH or jump into
 * `app.asar/node_modules`, so matching packages must also be asar-unpacked beside them.
 */
export const ELECTRON_PACKAGED_DEPENDENCIES = [
  '@vscode/ripgrep',
  'node-cron',
  'silk-wasm',
  'zod',
  'pino',
  'js-yaml',
  'markdown-it',
  'grammy',
  '@grammyjs/runner',
  '@inquirer/prompts',
  'abort-controller',
  'undici',
];

/** @param {string} repoRoot */
export function resolveInstalledElectronVersion(repoRoot) {
  const requireFromRoot = createRequire(join(repoRoot, 'package.json'));
  const pkgPath = requireFromRoot.resolve('electron/package.json');
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
      dependencies[name] = version;
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
