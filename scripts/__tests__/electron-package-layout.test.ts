import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DESKTOP_PACKAGE_PATHS, verifyCanonicalSqlBytes, verifyDesktopArtifactBytes, verifyDesktopPackageLayout } from '../electron-package-layout.mjs';

function fixture() {
  const files = new Map<string, Buffer>(DESKTOP_PACKAGE_PATHS.map((path: string) => [path, Buffer.from('resource')]));
  files.set('out/server/upgrades/261_schema.sql', Buffer.from('SQL'));
  files.set('dist/gateway/static/root/index.html', Buffer.from('<script src="/assets/app-123.js"></script><link href="/assets/app-123.css" rel="stylesheet">'));
  files.set('dist/gateway/static/root/assets/app-123.js', Buffer.from('script'));
  files.set('dist/gateway/static/root/assets/app-123.css', Buffer.from('css'));
  return { files, verify: () => verifyDesktopPackageLayout((path: string) => files.get(path), ['261_schema.sql']) };
}

describe('desktop package resource gate', () => {
  it('hashes the local and remote resources and every supported SQL upgrade', () => {
    const value = fixture(); const before = value.verify();
    value.files.set('out/preload/remote-shell.js', Buffer.from('different bytes'));
    expect(value.verify().files['out/preload/remote-shell.js']).not.toBe(before.files['out/preload/remote-shell.js']);
  });
  it.each(['out/main/remote-shell-worker.js', 'out/preload/shell.cjs', 'out/preload/remote-shell.js', 'out/server/schema.sql', 'out/server/upgrades/261_schema.sql', 'dist/gateway/static/root/assets/app-123.js'])('rejects incomplete package: %s', path => {
    const value = fixture(); value.files.delete(path);
    expect(value.verify).toThrow(/Missing or empty/);
  });
  it('validates resources extracted from a real ASAR on the host filesystem', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-asar-layout-'));
    try {
      const require = createRequire(import.meta.url);
      const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
      const asar = builderRequire('@electron/asar');
      const value = fixture();
      for (const [path, bytes] of value.files) {
        mkdirSync(dirname(join(root, 'input', path)), { recursive: true });
        writeFileSync(join(root, 'input', path), bytes);
      }
      const archive = join(root, 'app.asar');
      await asar.createPackage(join(root, 'input'), archive);
      const extracted = join(root, 'extracted');
      asar.extractAll(archive, extracted);
      const read = (path: string) => readFileSync(join(extracted, path));
      expect(verifyDesktopPackageLayout(read, ['261_schema.sql'])).toEqual(value.verify());
      rmSync(join(extracted, 'out/main/index.js'));
      expect(() => verifyDesktopPackageLayout(read, ['261_schema.sql'])).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects a packaged UI without its local script entry', () => {
    const value = fixture(); value.files.set('dist/gateway/static/root/index.html', Buffer.from('<html></html>'));
    expect(value.verify).toThrow(/no script asset/);
  });
  it('rejects missing lazy chunks and stale SQL bytes even when entry resources exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-s4-layout-'));
    const paths = ['out/main/chunks/lazy.js', 'out/preload/shell.cjs', 'out/server/schema.sql', 'dist/gateway/static/root/index.html',
      'src/storage/sqlite/schema.sql', 'src/storage/sqlite/upgrades/261_schema.sql'];
    try {
      for (const path of paths) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), 'current'); }
      const read = (path: string) => readFileSync(join(root, path));
      expect(Object.keys(verifyDesktopArtifactBytes(read, root).files)).toHaveLength(4);
      expect(() => verifyDesktopArtifactBytes((path: string) => path.includes('lazy') ? undefined : read(path), root)).toThrow(/differs from build/);
      expect(() => verifyCanonicalSqlBytes((path: string) => path.endsWith('schema.sql') ? Buffer.from('stale') : Buffer.from('current'), root)).toThrow(/canonical/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
