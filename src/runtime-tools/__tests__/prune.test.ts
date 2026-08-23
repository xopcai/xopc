import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RuntimeToolsConfigSchema } from '../../config/schema.js';
import { writeRuntimeManifest } from '../manifest-store.js';
import { pruneRuntimeTools } from '../prune.js';

describe('runtime pruning', () => {
  it('keeps the active version while removing inactive versions beyond retention', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'xopc-runtime-prune-'));
    try {
      const versions = join(stateDir, 'tools', 'node', 'versions');
      const active = join(versions, '22.0.0');
      const inactive = join(versions, '21.0.0');
      await mkdir(active, { recursive: true });
      await mkdir(inactive, { recursive: true });
      await writeFile(join(active, 'node'), 'active');
      await writeFile(join(inactive, 'node'), 'inactive');
      const now = new Date().toISOString();
      await writeRuntimeManifest(stateDir, {
        schemaVersion: 1,
        runtime: 'node',
        version: '22.0.0',
        source: 'managed',
        platform: process.platform,
        arch: process.arch,
        installDir: active,
        executables: { primary: join(active, 'node'), node: join(active, 'node') },
        installedAt: now,
        verifiedAt: now,
        probe: { versionOutput: 'v22.0.0' },
      });

      const result = await pruneRuntimeTools({
        stateDir,
        config: RuntimeToolsConfigSchema.parse({ retention: { keepVersions: 1 } }),
      });

      expect(result.removed).toContain(inactive);
      expect(result.removed).not.toContain(active);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
