import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dependencyRecords, windowsSigningBoundary, createDesktopInventory } from '../electron-dependency-inventory.mjs';

describe('artifact dependency and signature boundaries', () => {
  it.each(['resources/bin/cua-driver.exe', 'resources/bin/rg.exe', 'resources/app.asar.unpacked/node_modules/a/native.node', 'third-party.dll'])('does not authorize re-signing upstream %s', file => {
    expect(windowsSigningBoundary(file)).toBe('third-party-do-not-resign');
  });
  it('requires explicit approval for launchers/installers and rejects traversal', () => {
    expect(windowsSigningBoundary('xopc.exe')).toContain('requires-approval');
    expect(windowsSigningBoundary('xopc-0.0.439-arm64.exe', 'installer')).toContain('requires-approval');
    expect(windowsSigningBoundary('resources/bin/voice-hotkey-helper.exe')).toBe('project-built-helper');
    expect(windowsSigningBoundary('../xopc.exe')).toBe('reject');
  });
  it('retains source, version, declared licenses and actual notice text from bundle input packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-dependency-fixture-'));
    try {
      const dir = join(root, 'node_modules', 'fixture'); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '2.3.4', license: 'MPL-2.0', repository: 'https://example.test/source' }));
      writeFileSync(join(dir, 'LICENSE'), 'actual license text');
      const records = dependencyRecords([join(dir, 'index.js'), join(dir, 'other.js')], root);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ name: 'fixture', version: '2.3.4', license: 'MPL-2.0', notices: [{ file: 'LICENSE', text: 'actual license text' }] });
      expect(() => createDesktopInventory(root, root, { platform: 'win32', arch: 'arm64' })).toThrow('Build inventory missing');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('inventories actual target bytes, internal aliases and notices without treating review flags as approval', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-artifact-fixture-'));
    const pack = join(root, 'pack');
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      for (const path of ['out/main', 'out/preload', 'out/server', 'dist/gateway/static/root', 'dist/electron/extensions']) {
        mkdirSync(join(pack, path), { recursive: true });
        writeFileSync(join(pack, path, 'dependency-records.json'), JSON.stringify({ schemaVersion: 1, packages: [] }));
      }
      const library = join(pack, 'node_modules', 'fixture'); mkdirSync(library, { recursive: true });
      writeFileSync(join(library, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', license: 'MPL-2.0' }));
      writeFileSync(join(library, 'LICENSE'), 'upstream notice');
      writeFileSync(join(library, 'index.js'), 'actual shipped bytes');
      if (process.platform !== 'win32') symlinkSync('index.js', join(library, 'alias.js'));
      writeFileSync(join(pack, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0');
      const report = createDesktopInventory(pack, root, { platform: 'win32', arch: 'arm64' }) as any;
      expect(report.target.arch).toBe('arm64');
      expect(report.packages[0]).toMatchObject({ name: 'fixture', version: '1.0.0', notices: [{ file: 'LICENSE', text: 'upstream notice' }] });
      expect(report.files['node_modules/fixture/index.js'].bytes).toBe(20);
      expect(report.signPathReady).toBe(false);
      expect(report.reviewRequired).toEqual([{ package: 'fixture@1.0.0', license: 'MPL-2.0', missingNotice: false }]);
      expect(readFileSync(join(pack, '_pack-resources/compliance/runtime-pnpm-lock.yaml'), 'utf8')).toBe('lockfileVersion: 9.0');
      if (process.platform !== 'win32') {
        expect(report.files['node_modules/fixture/alias.js'].linkTarget).toBe('node_modules/fixture/index.js');
        symlinkSync(join(root, 'package.json'), join(library, 'escape'));
        expect(() => createDesktopInventory(pack, root, { platform: 'win32', arch: 'arm64' })).toThrow('escapes package');
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

});
