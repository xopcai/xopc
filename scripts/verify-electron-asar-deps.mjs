#!/usr/bin/env node
/** Verify the packaged Electron app contains only the minimal runtime layout. */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELECTRON_PACKAGED_DEPENDENCIES } from './electron-runtime-externals.mjs';
import { supportedUpgradeFiles, verifyCanonicalSqlBytes, verifyDesktopArtifactBytes, verifyDesktopPackageLayout } from './electron-package-layout.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireRoot = createRequire(join(root, 'package.json'));
const requireFromBuilder = createRequire(requireRoot.resolve('electron-builder/package.json'));
const asar = requireFromBuilder('@electron/asar');
// Includes the PDF.js parser and its required Canvas native runtime across target platforms.
export const DEFAULT_MAX_NODE_MODULES_BYTES = 125 * 1024 * 1024;
const maxNodeModulesBytes = Number(
  process.env['XOPC_ELECTRON_ASAR_NODE_MODULES_MAX_BYTES'] ?? DEFAULT_MAX_NODE_MODULES_BYTES,
);

function findAppAsarFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) findAppAsarFiles(p, acc);
    else if (entry.name === 'app.asar') acc.push(p);
  }
  return acc;
}

function findDefaultAsar(releaseDir = join(root, 'dist/release')) {
  const asars = findAppAsarFiles(releaseDir);
  if (asars.length === 0) throw new Error('No packaged app.asar found under dist/release/');
  asars.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return asars[0];
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(p);
    else if (entry.isFile()) total += statSync(p).size;
  }
  return total;
}

function packageDir(rootDir, name) {
  return join(rootDir, 'node_modules', ...name.split('/'));
}

function verifyUnpackedRuntimeDeps(asarPath) {
  const unpackedDir = join(dirname(asarPath), 'app.asar.unpacked');
  const missing = ELECTRON_PACKAGED_DEPENDENCIES.filter((name) => !existsSync(packageDir(unpackedDir, name)));
  if (missing.length > 0) {
    console.error(`[verify-electron-asar-deps] missing runtime deps: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`[verify-electron-asar-deps] OK — runtime deps present (${ELECTRON_PACKAGED_DEPENDENCIES.join(', ')})`);
}

function verifyUnpackedAppLayout(asarPath) {
  const unpackedDir = join(dirname(asarPath), 'app.asar.unpacked');
  const required = [
    'out/preload/connections.cjs',
    'out/preload/shell.cjs',
    'out/preload/gateway-connections.html',
    'out/preload/gateway-connections.js',
    'out/preload/remote-shell.html',
    'out/preload/remote-shell.js',
    'out/preload/remote-shell.css',
    'out/preload/screen-capture.html',
    'out/server/index.js',
    'out/server/codemode-worker.js',
    'node_modules/quickjs-wasi/quickjs.wasm',
    'dist/electron/extensions',
    'dist/gateway/static/root/index.html',
    'skills/tools/find-skills/SKILL.md',
  ];
  const missing = required.filter((rel) => !existsSync(join(unpackedDir, rel)));
  if (missing.length > 0) {
    console.error(`[verify-electron-asar-deps] missing runtime paths: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('[verify-electron-asar-deps] OK — unpacked app runtime layout present');
}

export { findDefaultAsar };

function main() {
  const inputArg = process.argv[2];
  const input = inputArg ? resolve(process.cwd(), inputArg) : findDefaultAsar();
  const asarPath = input.endsWith('.app') ? join(input, 'Contents/Resources/app.asar') : input;
  if (!existsSync(asarPath)) {
    console.error(`[verify-electron-asar-deps] app.asar not found: ${asarPath}`);
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'xopc-asar-verify-'));
  try {
    asar.extractAll(asarPath, tmp);
    const nm = join(tmp, 'node_modules');
    if (existsSync(nm)) {
      const bytes = dirSizeBytes(nm);
      if (bytes > maxNodeModulesBytes) {
        console.error(
          `[verify-electron-asar-deps] node_modules too large: ${(bytes / 1024 / 1024).toFixed(2)} MB ` +
            `(max ${(maxNodeModulesBytes / 1024 / 1024).toFixed(2)} MB)`,
        );
        process.exit(1);
      }
      console.log(`[verify-electron-asar-deps] OK — node_modules ${(bytes / 1024 / 1024).toFixed(2)} MB`);
    }
    verifyUnpackedRuntimeDeps(asarPath);
    verifyUnpackedAppLayout(asarPath);
    // ASAR extraction uses host separators; logical manifest paths remain portable.
    const read = path => readFileSync(join(tmp, path));
    const manifest = verifyDesktopPackageLayout(read, supportedUpgradeFiles(root));
    verifyCanonicalSqlBytes(read, root);
    console.log(`[verify-electron-asar-deps] OK — ${Object.keys(manifest.files).length} desktop UI, Shell, Gateway and SQL resources`);
    const artifacts = verifyDesktopArtifactBytes(read, root);
    console.log(`[verify-electron-asar-deps] OK — ${Object.keys(artifacts.files).length} packaged files match built runtime bytes`);
    if (process.platform === 'darwin' && asarPath.includes('Contents/Resources/')) {
      const native = join(dirname(asarPath), 'bin/desktop-workspace.node'), worker = join(dirname(asarPath), 'bin/workspace-worker.cjs');
      if (!existsSync(native) || statSync(native).size < 4096) throw new Error('Native workspace adapter is missing or empty');
      if (!readFileSync(worker).equals(readFileSync(join(root, 'electron/desktop/workspace-worker.cjs')))) throw new Error('Workspace worker does not match its trusted source');
      console.log('[verify-electron-asar-deps] OK — native workspace adapter present and worker bytes verified');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
