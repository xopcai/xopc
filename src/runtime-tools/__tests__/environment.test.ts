import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RuntimeToolsConfigSchema } from '../../config/schema.js';
import { buildRuntimeEnvironment, resolveRuntimeCommand } from '../environment.js';

describe('runtime environment', () => {
  it('removes host runtime pollution and resolves a system Node.js executable', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'xopc-runtime-env-'));
    const config = RuntimeToolsConfigSchema.parse({
      node: {
        version: process.version.slice(1),
        preference: 'system-only',
        provision: 'disabled',
      },
      python: { enabled: false },
      uv: { enabled: false },
    });
    try {
      const skillBin = join(stateDir, 'tools', 'environments', 'skills', 'demo', 'bin');
      const unrelatedSkillBin = join(stateDir, 'tools', 'environments', 'skills', 'unrelated', 'bin');
      await mkdir(skillBin, { recursive: true });
      await mkdir(unrelatedSkillBin, { recursive: true });
      const result = await buildRuntimeEnvironment({
        stateDir,
        config,
        runtimes: ['node'],
        skillEnvironmentIds: ['demo'],
        baseEnv: {
          PATH: process.env.PATH ?? '',
          NODE_OPTIONS: '--require=/tmp/host-hook.js',
          NODE_PATH: '/tmp/host-modules',
          PYTHONPATH: '/tmp/host-python',
        },
      });

      expect(result.env.NODE_OPTIONS).toBeUndefined();
      expect(result.env.NODE_PATH).toBeUndefined();
      expect(result.env.PYTHONPATH).toBeUndefined();
      expect(result.env.COREPACK_HOME).toContain(join('tools', 'cache', 'corepack'));
      expect(result.env.PATH?.split(process.platform === 'win32' ? ';' : ':')).toContain(skillBin);
      expect(result.env.PATH?.split(process.platform === 'win32' ? ';' : ':')).not.toContain(unrelatedSkillBin);
      expect(result.resolved).toEqual([
        expect.objectContaining({ runtime: 'node', source: 'system' }),
      ]);
      await expect(resolveRuntimeCommand({
        command: 'node',
        stateDir,
        config,
        allowProvision: false,
      })).resolves.toBeTruthy();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
