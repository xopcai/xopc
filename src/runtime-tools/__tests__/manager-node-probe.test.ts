import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RuntimeToolsConfigSchema } from '../../config/schema.js';
import { ManagedRuntimeManager } from '../manager.js';
import { writeRuntimeManifest } from '../manifest-store.js';
import { runtimeVersionDir } from '../paths.js';

describe('managed Node.js package manager probe', () => {
  it.skipIf(process.platform === 'win32')(
    'finds the managed Node.js binary when the host PATH does not contain node',
    async () => {
      const stateDir = await mkdtemp(join(tmpdir(), 'xopc-runtime-node-probe-'));
      const version = '22.23.2';
      const installDir = runtimeVersionDir(stateDir, 'node', version);
      const binDir = join(installDir, 'bin');
      const node = join(binDir, 'node');
      const npm = join(binDir, 'npm');
      const npx = join(binDir, 'npx');
      const originalPath = process.env.PATH;

      try {
        await mkdir(binDir, { recursive: true });
        await writeFile(node, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v22.23.2; else echo 10.9.8; fi\n');
        await writeFile(npm, '#!/usr/bin/env node\n');
        await writeFile(npx, '#!/usr/bin/env node\n');
        await Promise.all([node, npm, npx].map(async (path) => await chmod(path, 0o755)));
        await writeRuntimeManifest(stateDir, {
          schemaVersion: 1,
          runtime: 'node',
          version,
          source: 'managed',
          platform: process.platform,
          arch: process.arch,
          installDir,
          executables: { primary: node, node, npm, npx },
          installedAt: '2026-08-29T00:00:00.000Z',
          verifiedAt: '2026-08-29T00:00:00.000Z',
          probe: { versionOutput: `v${version}`, packageManagerVersion: '10.9.8' },
        });

        process.env.PATH = '/usr/bin:/bin';
        const config = RuntimeToolsConfigSchema.parse({ node: { version } });
        const manager = new ManagedRuntimeManager({ stateDir, config });

        await expect(manager.probeManaged('node', version)).resolves.toMatchObject({
          runtime: 'node',
          version,
          source: 'managed',
        });
      } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        await rm(stateDir, { recursive: true, force: true });
      }
    },
  );
});
