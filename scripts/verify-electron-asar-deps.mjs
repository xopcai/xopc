#!/usr/bin/env node
/**
 * Fail when app.asar contains an oversized node_modules tree (pnpm workspace leak).
 * Usage: node scripts/verify-electron-asar-deps.mjs [path-to-xopc.app-or-app.asar]
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ELECTRON_PACKAGED_DEPENDENCIES } from './electron-runtime-externals.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireRoot = createRequire(join(root, 'package.json'));
const requireFromBuilder = createRequire(requireRoot.resolve('electron-builder/package.json'));
const asar = requireFromBuilder('@electron/asar');

const maxNodeModulesBytes = Number(process.env['XOPC_ELECTRON_ASAR_NODE_MODULES_MAX_BYTES'] ?? 15 * 1024 * 1024);

function findAppAsarFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      findAppAsarFiles(p, acc);
    } else if (entry.name === 'app.asar') {
      acc.push(p);
    }
  }
  return acc;
}

function findDefaultAsar() {
  const releaseDir = join(root, 'dist/release');
  const asars = findAppAsarFiles(releaseDir);
  if (asars.length === 0) {
    throw new Error('No packaged app.asar found under dist/release/ — run electron:package first');
  }
  // Prefer the most recently packaged asar (macOS CI builds x64 then arm64 sequentially).
  asars.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return asars[0];
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(p);
    } else if (entry.isFile()) {
      total += statSync(p).size;
    }
  }
  return total;
}

function packageDir(rootDir, name) {
  return join(rootDir, 'node_modules', ...name.split('/'));
}

function verifyUnpackedRuntimeDeps(asarPath) {
  const unpackedDir = join(dirname(asarPath), 'app.asar.unpacked');
  const unpackedServer = join(unpackedDir, 'out', 'server', 'index.js');
  if (!existsSync(unpackedServer)) {
    return;
  }

  const missing = ELECTRON_PACKAGED_DEPENDENCIES.filter((name) => !existsSync(packageDir(unpackedDir, name)));
  if (missing.length > 0) {
    console.error(
      `[verify-electron-asar-deps] app.asar.unpacked is missing runtime deps for unpacked gateway: ${missing.join(', ')}. ` +
        'Add them to asarUnpack in scripts/electron-builder.pack.yml.',
    );
    process.exit(1);
  }
  console.log(
    `[verify-electron-asar-deps] OK — unpacked gateway runtime deps present (${ELECTRON_PACKAGED_DEPENDENCIES.join(', ')})`,
  );
}

function verifyUnpackedAppLayout(asarPath) {
  const unpackedDir = join(dirname(asarPath), 'app.asar.unpacked');
  const required = [
    'out/server/index.js',
    'dist/gateway/static/root/index.html',
    'dist/extensions',
    'dist/src',
  ];
  const missing = required.filter((rel) => !existsSync(join(unpackedDir, rel)));
  if (missing.length > 0) {
    console.error(
      `[verify-electron-asar-deps] app.asar.unpacked is missing packaged runtime paths: ${missing.join(', ')}. ` +
        'Check prepare-electron-pack-dir.mjs and asarUnpack in scripts/electron-builder.pack.yml.',
    );
    process.exit(1);
  }
  console.log('[verify-electron-asar-deps] OK — unpacked app runtime layout present');
}

export { findDefaultAsar };

function main() {
  const inputArg = process.argv[2];
  const input = inputArg ? join(process.cwd(), inputArg) : findDefaultAsar();
  let asarPath = input;
  if (input.endsWith('.app')) {
    asarPath = join(input, 'Contents/Resources/app.asar');
  }
  if (!existsSync(asarPath)) {
    console.error(`[verify-electron-asar-deps] app.asar not found: ${asarPath}`);
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'xopc-asar-verify-'));
  try {
    asar.extractAll(asarPath, tmp);
    const nm = join(tmp, 'node_modules');
    if (!existsSync(nm)) {
      console.log('[verify-electron-asar-deps] OK — no node_modules in asar');
    } else {
      const bytes = dirSizeBytes(nm);
      const mb = (bytes / (1024 * 1024)).toFixed(2);
      const maxMb = (maxNodeModulesBytes / (1024 * 1024)).toFixed(2);
      if (bytes > maxNodeModulesBytes) {
        console.error(
          `[verify-electron-asar-deps] node_modules too large: ${mb} MB (max ${maxMb} MB). ` +
            'pnpm workspace deps may have been bundled — check prepare-electron-pack-dir.mjs',
        );
        process.exit(1);
      }
      console.log(`[verify-electron-asar-deps] OK — node_modules ${mb} MB (max ${maxMb} MB)`);
    }
    verifyUnpackedRuntimeDeps(asarPath);
    verifyUnpackedAppLayout(asarPath);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
