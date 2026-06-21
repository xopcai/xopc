#!/usr/bin/env node
/** Verify the packaged Electron app contains only the minimal runtime layout. */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELECTRON_PACKAGED_DEPENDENCIES } from './electron-runtime-externals.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireRoot = createRequire(join(root, 'package.json'));
const requireFromBuilder = createRequire(requireRoot.resolve('electron-builder/package.json'));
const asar = requireFromBuilder('@electron/asar');
const maxNodeModulesBytes = Number(process.env['XOPC_ELECTRON_ASAR_NODE_MODULES_MAX_BYTES'] ?? 10 * 1024 * 1024);

function findAppAsarFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) findAppAsarFiles(p, acc);
    else if (entry.name === 'app.asar') acc.push(p);
  }
  return acc;
}

function findDefaultAsar() {
  const asars = findAppAsarFiles(join(root, 'dist/release'));
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
    'out/server/index.js',
    'dist/electron/extensions',
    'dist/gateway/static/root/index.html',
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
  const input = inputArg ? join(process.cwd(), inputArg) : findDefaultAsar();
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
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
