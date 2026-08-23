import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readRuntimeManifest, writeRuntimeManifest } from '../manifest-store.js';
import type { InstalledRuntimeManifest } from '../types.js';

describe('runtime manifest store', () => {
  it('atomically persists and reads a valid manifest', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'xopc-runtime-manifest-'));
    const manifest: InstalledRuntimeManifest = {
      schemaVersion: 1,
      runtime: 'node',
      version: '22.23.2',
      source: 'managed',
      platform: 'darwin',
      arch: 'arm64',
      installDir: join(stateDir, 'tools/node/versions/22.23.2'),
      executables: { primary: '/test/node', node: '/test/node' },
      installedAt: '2026-08-23T00:00:00.000Z',
      verifiedAt: '2026-08-23T00:00:00.000Z',
      probe: { versionOutput: 'v22.23.2' },
    };
    await writeRuntimeManifest(stateDir, manifest);
    await expect(readRuntimeManifest(stateDir, 'node')).resolves.toEqual(manifest);
  });
});
