import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

export const DESKTOP_PACKAGE_PATHS = [
  'out/main/index.js', 'out/main/main.js',
  'out/preload/index.cjs',
  'out/preload/computer-preview.cjs', 'out/preload/computer-preview.html',
  'out/server/index.js', 'out/server/gateway.js', 'out/server/result-extraction.js', 'out/server/codemode-worker.js',
  'out/server/runtime-files.json',
  'out/server/schema.sql', 'out/server/workspace-templates/AGENTS.md',
  'dist/gateway/static/root/index.html',
];

/** Validate actual package bytes through an asar or staging-directory reader. */
export function verifyDesktopPackageLayout(read, upgradeFiles) {
  const required = [...DESKTOP_PACKAGE_PATHS, ...upgradeFiles.map(name => `out/server/upgrades/${name}`)];
  const hashes = {};
  const check = path => {
    const bytes = read(path);
    assert(bytes?.length, `Missing or empty desktop package resource: ${path}`);
    hashes[path] = createHash('sha256').update(bytes).digest('hex');
    return bytes.toString('utf8');
  };
  for (const path of required) check(path);
  const runtimeFiles = JSON.parse(check('out/server/runtime-files.json'));
  assert(Array.isArray(runtimeFiles) && runtimeFiles.length > 0, 'Missing Gateway runtime files');
  for (const name of runtimeFiles) {
    assert(typeof name === 'string' && /^[\w.-]+\.(?:js|cjs|json)$/.test(name), 'Invalid Gateway runtime file');
    check(posix.join('out/server/runtime', name));
  }
  // Vite chunks are content-addressed; checking index.html alone misses broken staged assets.
  const html = check('dist/gateway/static/root/index.html');
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => match[1]).filter(path => path.startsWith('/assets/') || path.startsWith('./assets/'));
  assert(assets.some(path => path.endsWith('.js')), 'Packaged local UI has no script asset');
  for (const path of assets) {
    const relative = path.replace(/^\.?\//, '');
    assert(!relative.includes('..') && !relative.includes('?'), 'Invalid packaged UI asset reference');
    check(posix.join('dist/gateway/static/root', relative));
  }
  return { schemaVersion: 1, files: hashes };
}

export function supportedUpgradeFiles(root) {
  return readdirSync(join(root, 'src/storage/sqlite/upgrades')).filter(name => name.endsWith('.sql')).sort();
}

export function verifyStagedDesktopPackage(directory, root) {
  const read = path => readFileSync(join(directory, path));
  const manifest = verifyDesktopPackageLayout(read, supportedUpgradeFiles(root));
  verifyCanonicalSqlBytes(read, root);
  return manifest;
}

export function verifyCanonicalSqlBytes(read, root) {
  for (const path of ['schema.sql', ...supportedUpgradeFiles(root).map(name => `upgrades/${name}`)]) {
    assert(read(`out/server/${path}`)?.equals(readFileSync(join(root, 'src/storage/sqlite', path))), `Packaged SQL differs from canonical source: ${path}`);
  }
}

/** Compare all emitted runtime chunks and assets, so missing lazy chunks cannot pass. */
export function verifyDesktopArtifactBytes(read, root) {
  const files = {};
  for (const directory of ['out/main', 'out/preload', 'out/server', 'dist/gateway/static/root']) {
    for (const entry of readdirSync(join(root, directory), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || entry.name.endsWith('.map')) continue;
      const path = posix.join(directory, relative(join(root, directory), join(entry.parentPath, entry.name)).split(sep).join('/'));
      const expected = readFileSync(join(root, path));
      const actual = read(path);
      assert(actual?.equals(expected), `Packaged artifact differs from build: ${path}`);
      files[path] = createHash('sha256').update(actual).digest('hex');
    }
  }
  return { schemaVersion: 1, files };
}
