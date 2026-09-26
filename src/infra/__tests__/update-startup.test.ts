import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { PACKAGE_VERSION } from '../../package-version.js';

const mocks = vi.hoisted(() => ({
  resolveNpmChannelTag: vi.fn(),
}));

vi.mock('../update-check.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../update-check.js')>()),
  resolveNpmChannelTag: mocks.resolveNpmChannelTag,
}));

import { runGatewayUpdateCheck } from '../update-startup.js';

describe('runGatewayUpdateCheck', () => {
  let stateDir: string | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    delete process.env.XOPC_STATE_DIR;
    if (stateDir) await rm(stateDir, { recursive: true, force: true });
    stateDir = undefined;
  });

  it('does not persist a successful-check timestamp when the registry lookup fails', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-update-startup-'));
    process.env.XOPC_STATE_DIR = stateDir;
    const statePath = join(stateDir, 'update-check.json');
    const initialState = {
      lastCheckedAt: '2026-09-24T00:00:00.000Z',
      lastCheckPackageVersion: '0.0.324',
    };
    await writeFile(statePath, JSON.stringify(initialState, null, 2));
    mocks.resolveNpmChannelTag.mockResolvedValue({
      tag: 'latest',
      version: null,
      error: 'HTTP 503',
    });

    const result = await runGatewayUpdateCheck({
      config: { update: { checkOnStart: true, channel: 'stable' } } as Config,
      force: true,
    });

    expect(result).toEqual({ ok: false, error: 'HTTP 503' });
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual(initialState);
  });

  it('bypasses the throttle when an older available version is left in state', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-update-startup-'));
    process.env.XOPC_STATE_DIR = stateDir;
    const statePath = join(stateDir, 'update-check.json');
    await writeFile(statePath, JSON.stringify({
      lastCheckedAt: new Date().toISOString(),
      lastCheckPackageVersion: PACKAGE_VERSION,
      lastAvailableVersion: '0.0.1',
      lastAvailableTag: 'latest',
    }));
    mocks.resolveNpmChannelTag.mockResolvedValue({
      tag: 'latest',
      version: PACKAGE_VERSION,
    });

    const result = await runGatewayUpdateCheck({
      config: { update: { checkOnStart: true, channel: 'stable' } } as Config,
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.resolveNpmChannelTag).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(statePath, 'utf8'))).not.toHaveProperty('lastAvailableVersion');
  });
});
