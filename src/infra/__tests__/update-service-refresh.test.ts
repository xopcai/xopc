import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GatewayService, GatewayServiceInstallArgs } from '../../daemon/types.js';
import {
  refreshGatewayServiceAfterUpdate,
  resolveUpdatedGatewayEntryPoint,
} from '../update-service-refresh.js';

describe('update-service-refresh', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function createUpdatedPackage(bin: string | Record<string, string> = {
    xopc: './dist/src/cli/bin.js',
  }): Promise<{ packageRoot: string; entryPoint: string }> {
    const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xopc-service-refresh-'));
    tempDirs.push(packageRoot);
    const entryPoint = path.join(packageRoot, 'dist', 'src', 'cli', 'bin.js');
    await fs.mkdir(path.dirname(entryPoint), { recursive: true });
    await fs.writeFile(entryPoint, '#!/usr/bin/env node\n');
    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@xopcai/xopc', version: '0.0.154', bin }),
    );
    return { packageRoot, entryPoint };
  }

  it('resolves the xopc CLI from the updated package metadata', async () => {
    const { packageRoot, entryPoint } = await createUpdatedPackage();
    await expect(resolveUpdatedGatewayEntryPoint(packageRoot)).resolves.toBe(entryPoint);
  });

  it('rejects a CLI entry point outside the updated package', async () => {
    const { packageRoot } = await createUpdatedPackage('../outside.js');
    await expect(resolveUpdatedGatewayEntryPoint(packageRoot)).rejects.toThrow(
      'escapes its package root',
    );
  });

  it('rewrites a loaded service to the updated package before restart', async () => {
    const { packageRoot, entryPoint } = await createUpdatedPackage();
    let installedArgs: GatewayServiceInstallArgs | undefined;
    const service = {
      label: 'xopc-gateway',
      loadedText: 'loaded',
      notLoadedText: 'not loaded',
      install: vi.fn(async (args: GatewayServiceInstallArgs) => {
        installedArgs = args;
      }),
      uninstall: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      isLoaded: vi.fn(async () => true),
      readRuntime: vi.fn(),
      readCommand: vi.fn(async () => ({
        programArguments: [
          '/usr/bin/node',
          '--enable-source-maps',
          '/pnpm/store/@xopcai/xopc/0.0.153/dist/src/cli/bin.js',
          'gateway',
          '--foreground',
          '--port',
          '18790',
        ],
        workingDirectory: '/home/admin/.xopc',
        environment: {
          XOPC_CONFIG: '/home/admin/.xopc/xopc.json',
          XOPC_SERVICE_VERSION: '0.0.153',
          CUSTOM_VALUE: 'preserved',
        },
      })),
    } satisfies GatewayService;

    await refreshGatewayServiceAfterUpdate({
      service,
      packageRoot,
      expectedVersion: '0.0.154',
      env: { XOPC_PROFILE: 'default' },
    });

    expect(service.install).toHaveBeenCalledOnce();
    expect(installedArgs?.programArguments).toEqual([
      '/usr/bin/node',
      '--enable-source-maps',
      entryPoint,
      'gateway',
      '--foreground',
      '--port',
      '18790',
    ]);
    expect(installedArgs?.environment).toMatchObject({
      XOPC_CONFIG: '/home/admin/.xopc/xopc.json',
      XOPC_SERVICE_VERSION: '0.0.154',
      XOPC_SERVICE_MARKER: '1',
      CUSTOM_VALUE: 'preserved',
    });
    expect(installedArgs?.workingDirectory).toBe('/home/admin/.xopc');
    expect(installedArgs?.description).toContain('v0.0.154');
  });
});
