import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { RuntimeToolsConfigSchema } from '../../config/schema.js';
import { ManagedRuntimeManager } from '../manager.js';
import { runtimeVersionDir } from '../paths.js';

describe('runtime repair rollback', () => {
  it('restores the previous installation when replacement fails', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'xopc-runtime-repair-'));
    const config = RuntimeToolsConfigSchema.parse({ node: { version: '22.0.0' } });
    const installDir = runtimeVersionDir(stateDir, 'node', '22.0.0');
    try {
      await mkdir(installDir, { recursive: true });
      await writeFile(join(installDir, 'sentinel'), 'old');
      const manager = new ManagedRuntimeManager({ stateDir, config });
      manager.install = vi.fn(async () => {
        await mkdir(installDir, { recursive: true });
        await writeFile(join(installDir, 'sentinel'), 'new');
        throw new Error('probe failed');
      });

      await expect(manager.repair('node')).rejects.toThrow('probe failed');
      await expect(readFile(join(installDir, 'sentinel'), 'utf8')).resolves.toBe('old');
      await expect(access(installDir)).resolves.toBeUndefined();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
