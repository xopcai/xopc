#!/usr/bin/env node
/**
 * Sync packages/browser-ext/manifest.json version with root package.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = rootPkg.version;
if (typeof version !== 'string' || !version.trim()) {
  console.error('Root package.json missing version');
  process.exit(1);
}

const manifestPath = join(root, 'packages/browser-ext/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version === version) {
  process.exit(0);
}
manifest.version = version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Synced browser-ext manifest version → ${version}`);
