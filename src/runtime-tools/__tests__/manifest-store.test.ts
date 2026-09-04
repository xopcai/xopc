import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readRuntimeManifest, readRuntimeManifests, writeRuntimeManifest } from '../manifest-store.js';
import { runtimeManifestPath } from '../paths.js';
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

  it('keeps manifests for multiple installed versions', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'xopc-runtime-manifest-'));
    const base: InstalledRuntimeManifest = {
      schemaVersion: 1,
      runtime: 'uv',
      version: '0.8.11',
      source: 'managed',
      platform: 'darwin',
      arch: 'arm64',
      installDir: join(stateDir, 'tools/uv/versions/0.8.11'),
      executables: { primary: '/test/uv', uv: '/test/uv' },
      installedAt: '2026-08-22T00:00:00.000Z',
      verifiedAt: '2026-08-22T00:00:00.000Z',
      probe: { versionOutput: 'uv 0.8.11' },
    };
    await writeRuntimeManifest(stateDir, base);
    await writeRuntimeManifest(stateDir, {
      ...base,
      version: '0.8.12',
      installDir: join(stateDir, 'tools/uv/versions/0.8.12'),
      verifiedAt: '2026-08-23T00:00:00.000Z',
    });
    await expect(readRuntimeManifests(stateDir, 'uv')).resolves.toMatchObject([
      { version: '0.8.12' },
      { version: '0.8.11' },
    ]);
  });

  it('reads the legacy per-runtime manifest format', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'xopc-runtime-manifest-'));
    const manifest: InstalledRuntimeManifest = {
      schemaVersion: 1,
      runtime: 'python',
      version: '3.12.11',
      source: 'managed',
      platform: 'darwin',
      arch: 'arm64',
      installDir: join(stateDir, 'tools/python/versions/3.12.11'),
      executables: { primary: '/test/python', python: '/test/python' },
      installedAt: '2026-08-23T00:00:00.000Z',
      verifiedAt: '2026-08-23T00:00:00.000Z',
      probe: { versionOutput: 'Python 3.12.11' },
    };
    const target = runtimeManifestPath(stateDir, 'python');
    await mkdir(join(stateDir, 'tools', 'manifests'), { recursive: true });
    await writeFile(target, JSON.stringify(manifest));
    await expect(readRuntimeManifest(stateDir, 'python')).resolves.toEqual(manifest);
  });
});
