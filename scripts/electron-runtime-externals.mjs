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

/** Production deps electron-builder should copy into app.asar (gateway bundle runtime). */
export const ELECTRON_PACKAGED_DEPENDENCIES = ['@vscode/ripgrep', 'node-cron', 'silk-wasm'];

/**
 * @param {Record<string, unknown>} rootPkg Parsed root package.json
 * @returns {Record<string, unknown>} package.json for electron-builder (minimal dependencies)
 */
export function buildMinimalElectronPackageJson(rootPkg) {
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
    devDependencies.electron = rootPkg.devDependencies.electron;
  }

  return {
    ...rest,
    dependencies,
    ...(Object.keys(devDependencies).length > 0 ? { devDependencies } : {}),
  };
}
