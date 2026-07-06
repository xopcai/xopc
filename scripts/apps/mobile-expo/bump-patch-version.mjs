#!/usr/bin/env node
/**
 * Reads app.json expo.version, bumps patch (x.y.Z+1), syncs package.json, prints new version.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const appDir = join(root, 'apps/mobile-expo');
const appJsonPath = join(appDir, 'app.json');
const appPkgPath = join(appDir, 'package.json');

const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const current = appJson.expo?.version;
if (typeof current !== 'string' || !/^\d+\.\d+\.\d+$/.test(current)) {
  throw new Error(`Invalid or non-semver expo.version: ${JSON.stringify(current)}`);
}

const parts = current.split('.').map((n) => Number.parseInt(n, 10));
const next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;

if (process.argv.includes('--print-next')) {
  process.stdout.write(next);
  process.exit(0);
}

appJson.expo.version = next;
writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

const appPkg = JSON.parse(readFileSync(appPkgPath, 'utf8'));
appPkg.version = next;
writeFileSync(appPkgPath, `${JSON.stringify(appPkg, null, 2)}\n`);

process.stdout.write(next);
