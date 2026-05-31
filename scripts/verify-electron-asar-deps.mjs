#!/usr/bin/env node
/**
 * Fail when app.asar contains an oversized node_modules tree (pnpm workspace leak).
 * Usage: node scripts/verify-electron-asar-deps.mjs [path-to-xopc.app-or-app.asar]
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireRoot = createRequire(join(root, 'package.json'));
const requireFromBuilder = createRequire(requireRoot.resolve('electron-builder/package.json'));
const asar = requireFromBuilder('@electron/asar');

const maxNodeModulesBytes = Number(process.env['XOPC_ELECTRON_ASAR_NODE_MODULES_MAX_BYTES'] ?? 15 * 1024 * 1024);

function findDefaultAsar() {
  const macAsar = join(root, 'dist/release/mac-arm64/xopc.app/Contents/Resources/app.asar');
  if (existsSync(macAsar)) return macAsar;
  throw new Error('No packaged app.asar found under dist/release/ — run electron:package first');
}

function dirSizeBytes(dir) {
  const out = execSync(`du -sk ${JSON.stringify(dir)}`, { encoding: 'utf8' }).trim();
  const kb = Number(out.split(/\s+/)[0]);
  return kb * 1024;
}

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
    process.exit(0);
  }
  const bytes = dirSizeBytes(nm);
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  const maxMb = (maxNodeModulesBytes / (1024 * 1024)).toFixed(2);
  if (bytes > maxNodeModulesBytes) {
    console.error(
      `[verify-electron-asar-deps] node_modules too large: ${mb} MB (max ${maxMb} MB). ` +
        'pnpm workspace deps may have been bundled — check electron-pack-context.mjs',
    );
    process.exit(1);
  }
  console.log(`[verify-electron-asar-deps] OK — node_modules ${mb} MB (max ${maxMb} MB)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
