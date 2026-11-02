import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { windowsSigningBoundary } from './electron-dependency-inventory.mjs';

/** Sidecar only: never mutate a signed application to add a post-sign manifest. */
export function writeFinishedDesktopInventory(resources, application, output) {
  const embedded = readFileSync(join(resources, 'compliance/dependency-inventory.json'));
  const inventory = JSON.parse(embedded.toString('utf8'));
  assert.equal(inventory.schemaVersion, 1);
  assert(inventory.packages.length && inventory.embeddedManifests.length >= 5, 'Missing dependency provenance');
  const files = [], binaries = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), name = relative(application, path).replaceAll('\\', '/');
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) { files.push({ file: name, symlink: readlinkSync(path) }); continue; }
      if (entry.isDirectory()) { walk(path); continue; }
      const bytes = readFileSync(path);
      const file = { file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      files.push(file);
      if (/\.(exe|dll|node)$/i.test(name)) binaries.push({ ...file, signing: windowsSigningBoundary(name) });
    }
  }
  walk(application);
  const report = { schemaVersion: 1, target: inventory.target, version: inventory.version,
    scope: 'Exact final application filesystem, with embedded dependency provenance; this is not a license approval or a trusted signature assertion',
    stagingInventorySha256: createHash('sha256').update(embedded).digest('hex'), packages: inventory.packages,
    reviewRequired: inventory.reviewRequired, unresolved: inventory.unresolved, signPathReady: false, files, binaries };
  writeFileSync(join(output, `dependency-inventory-${inventory.target.platform}-${inventory.target.arch}.json`), JSON.stringify(report, null, 2) + '\n');
  return report;
}
