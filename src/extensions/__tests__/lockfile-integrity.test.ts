import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  computeExtensionDirectoryIntegrity,
  ExtensionLockfileManager,
} from '../lockfile.js';

describe('extension lockfile integrity', () => {
  it('detects installed file changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-lock-integrity-'));
    try {
      const extensionsDir = join(root, 'extensions');
      const extensionDir = join(extensionsDir, 'integrity-test');
      mkdirSync(join(extensionDir, 'node_modules', 'dependency'), { recursive: true });
      writeFileSync(join(extensionDir, 'index.js'), 'export default 1;\n');
      writeFileSync(join(extensionDir, 'node_modules', 'dependency', 'index.js'), 'module.exports = 1;\n');
      const integrity = computeExtensionDirectoryIntegrity(extensionDir);
      const manager = new ExtensionLockfileManager(join(root, 'extensions.lock.json'), extensionsDir);
      await manager.upsert('integrity-test', {
        name: 'integrity-test',
        version: '1.0.0',
        resolved: 'integrity-test',
        source: 'local',
        installedIntegrity: integrity,
      });

      await expect(manager.verify('integrity-test')).resolves.toEqual({ valid: true });
      writeFileSync(join(extensionDir, 'node_modules', 'dependency', 'index.js'), 'module.exports = 2;\n');
      await expect(manager.verify('integrity-test')).resolves.toMatchObject({ valid: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires an installed integrity snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-lock-missing-integrity-'));
    try {
      const extensionsDir = join(root, 'extensions');
      mkdirSync(join(extensionsDir, 'missing-integrity'), { recursive: true });
      const manager = new ExtensionLockfileManager(join(root, 'extensions.lock.json'), extensionsDir);
      await manager.upsert('missing-integrity', {
        name: 'missing-integrity',
        version: '1.0.0',
        resolved: 'missing-integrity',
        source: 'local',
      });
      const result = await manager.verify('missing-integrity');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('no installed file integrity');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
