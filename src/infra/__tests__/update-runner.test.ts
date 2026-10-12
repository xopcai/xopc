import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  extensions: vi.fn(),
  resolveService: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../../daemon/service.js', () => ({ resolveGatewayService: mocks.resolveService }));
vi.mock('../../config/loader.js', () => ({ loadConfig: () => ({}) }));
vi.mock('../update-service-refresh.js', () => ({ refreshGatewayServiceAfterUpdate: mocks.refresh }));
vi.mock('../../extensions/update.js', () => ({ runPostUpdateExtensionSync: mocks.extensions }));
vi.mock('../package-update-steps.js', () => ({ runGlobalPackageUpdateSteps: mocks.install }));
vi.mock('../run-command.js', () => ({
  createDefaultCommandRunner: vi.fn(),
  runCommandWithTimeout: async () => ({ code: 1, stdout: '', stderr: '' }),
}));
vi.mock('../update-check.js', () => ({
  compareSemver: (a: string, b: string) => a === b ? 0 : -1,
  resolveNpmChannelTag: async () => ({ version: '99.0.0' }),
}));
vi.mock('../update-global.js', () => ({
  XOPC_PACKAGE_NAME: '@xopcai/xopc',
  createGlobalInstallEnv: async () => undefined,
  detectGlobalInstallManagerForRoot: async () => 'npm',
  resolveGlobalInstallTarget: async () => ({}),
  cleanupGlobalRenameDirs: vi.fn(),
  resolveGlobalInstallSpec: () => '@xopcai/xopc@99.0.0',
}));

import { formatUpdateApiResult, runGatewayUpdateWithPostSteps } from '../update-runner.js';

const service = { isLoaded: vi.fn(async () => true) };
let packageRoot: string;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv('XOPC_SERVICE_MARKER', '1');
  packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xopc-update-runner-'));
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@xopcai/xopc', version: '1.0.0' }));
  mocks.resolveService.mockResolvedValue(service);
  service.isLoaded.mockResolvedValue(true);
  mocks.extensions.mockResolvedValue({ status: 'skipped', tasks: [] });
  mocks.install.mockImplementation(async () => {
    // Simulate npm replacing the lazy-loaded daemon module with incompatible code.
    expect(mocks.resolveService).toHaveBeenCalledOnce();
    mocks.resolveService.mockRejectedValue(new SyntaxError('mixed module exports'));
    return { steps: [], verifiedPackageRoot: packageRoot, afterVersion: '99.0.0' };
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(packageRoot, { recursive: true, force: true });
});

function update(trigger = vi.fn(() => ({ ok: true }))) {
  return runGatewayUpdateWithPostSteps({ cwd: packageRoot, argv1: path.join(packageRoot, 'bin.js'), triggerInProcessRestart: trigger });
}

describe('update installation and restart handoff', () => {
  it('loads the daemon before npm replaces files and reuses it afterward', async () => {
    const trigger = vi.fn(() => ({ ok: true }));
    expect(await update(trigger)).toMatchObject({ status: 'ok', after: { version: '99.0.0' } });
    expect(trigger).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith(expect.objectContaining({ service }));
    expect(mocks.resolveService).toHaveBeenCalledOnce();
  });

  it('refuses to mutate the installation when restart preparation fails', async () => {
    mocks.resolveService.mockRejectedValue(new Error('unsupported supervisor'));
    expect(await update()).toMatchObject({ status: 'error', reason: 'restart-preparation-failed' });
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it.each(['error', 'throw'])('still restarts after extension sync %s', async (failure) => {
    if (failure === 'throw') mocks.extensions.mockRejectedValue(new Error('sync failed'));
    else mocks.extensions.mockResolvedValue({ status: 'error', tasks: [] });
    const trigger = vi.fn(() => ({ ok: true }));
    expect(await update(trigger)).toMatchObject({ status: 'error', reason: 'post-update-extensions', postUpdate: { restart: { ok: true } } });
    expect(trigger).toHaveBeenCalledOnce();
  });

  it('reports restart failure with the installed version instead of claiming success', async () => {
    const result = await update(vi.fn(() => ({ ok: false, message: 'respawn disabled' })));
    expect(result).toMatchObject({ status: 'error', reason: 'post-update-restart' });
    expect(formatUpdateApiResult(result, 'stable')).toMatchObject({ status: 'error', installedVersion: '99.0.0', message: 'respawn disabled' });
  });

  it('retries restart when disk is current but the running gateway is old', async () => {
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@xopcai/xopc', version: '99.0.0' }));
    const trigger = vi.fn(() => ({ ok: true }));
    expect(await update(trigger)).toMatchObject({ status: 'ok', postUpdate: { restart: { ok: true } } });
    expect(trigger).toHaveBeenCalledOnce();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.extensions).not.toHaveBeenCalled();
  });

  it('preserves an explicit no-restart update', async () => {
    mocks.install.mockResolvedValue({ steps: [], verifiedPackageRoot: packageRoot, afterVersion: '99.0.0' });
    const trigger = vi.fn(() => ({ ok: true }));
    const result = await runGatewayUpdateWithPostSteps({
      cwd: packageRoot, argv1: path.join(packageRoot, 'bin.js'),
      shouldRestart: false, triggerInProcessRestart: trigger,
    });
    expect(result).toMatchObject({ status: 'ok', postUpdate: { restart: { mode: 'skipped' } } });
    expect(mocks.resolveService).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });
});
