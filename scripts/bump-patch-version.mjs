#!/usr/bin/env node
/**
 * Reads root package.json version, bumps patch (x.y.Z+1), updates all
 * release-aligned manifests, prints the new version on stdout (no newline extras).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootPkgPath = join(root, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
const current = rootPkg.version;
if (typeof current !== 'string' || !/^\d+\.\d+\.\d+$/.test(current)) {
  throw new Error(`Invalid or non-semver root version: ${JSON.stringify(current)}`);
}
const parts = current.split('.').map((n) => Number.parseInt(n, 10));
const next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;

if (process.argv.includes('--print-next')) {
  process.stdout.write(next);
  process.exit(0);
}

const files = [
  'package.json',
  'web/package.json',
  'packages/extension-ui-sdk/package.json',
  'extensions/telegram/package.json',
  'extensions/telegram/xopc.extension.json',
];

const versionKeyRe = (v) => new RegExp(`^([ \\t]*"version"\\s*:\\s*)"${v.replaceAll('.', '\\.')}"`, 'm');

const pendingUpdates = [];

for (const rel of files) {
  const abs = join(root, rel);
  const raw = readFileSync(abs, 'utf8');
  const currentRe = versionKeyRe(current);
  const nextRe = versionKeyRe(next);
  const alreadyNext = nextRe.test(raw);
  if (!currentRe.test(raw) && !alreadyNext) {
    throw new Error(`${rel}: version must be "${current}" or "${next}" before bump`);
  }
  const updated = alreadyNext ? raw : raw.replace(currentRe, `$1"${next}"`);
  const reNext = versionKeyRe(next);
  const reNextGlobal = new RegExp(reNext.source, `${reNext.flags}g`);
  const matches = updated.match(reNextGlobal);
  if (!matches || matches.length !== 1) {
    throw new Error(`${rel}: expected exactly one bumped version field`);
  }
  pendingUpdates.push({ abs, updated });
}

for (const { abs, updated } of pendingUpdates) {
  writeFileSync(abs, updated);
}

process.stdout.write(next);
