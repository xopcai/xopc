import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveService: vi.fn(),
  refresh: vi.fn(),
  loadConfig: vi.fn(),
}));
vi.mock('../../daemon/service.js', () => ({ resolveGatewayService: mocks.resolveService }));
vi.mock('../../config/loader.js', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../update-service-refresh.js', () => ({ refreshGatewayServiceAfterUpdate: mocks.refresh }));

import { maybeRestartGatewayAfterUpdate, prepareGatewayRestart } from '../update-restart.js';
import type { GatewayService } from '../../daemon/types.js';

const service = {
  isLoaded: vi.fn(),
  readCommand: vi.fn(),
  restart: vi.fn(),
} as unknown as GatewayService;

describe('gateway restart after update', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.loadConfig.mockReturnValue({ gateway: { auth: { token: 'test-token' } } });
    mocks.resolveService.mockResolvedValue(service);
    vi.mocked(service.isLoaded).mockResolvedValue(true);
    vi.mocked(service.readCommand).mockResolvedValue({ programArguments: ['node', 'xopc', 'gateway', '--port', '19876'] });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses the platform module loaded before files were replaced', async () => {
    vi.stubEnv('XOPC_SERVICE_MARKER', '1');
    const preparedService = await prepareGatewayRestart();
    mocks.resolveService.mockRejectedValue(new SyntaxError('new module missing old export'));
    const trigger = vi.fn(() => ({ ok: true }));
    const result = await maybeRestartGatewayAfterUpdate({
      preparedService, triggerInProcessRestart: trigger, updatedPackageRoot: '/updated', expectedVersion: '2.0.0',
    });
    expect(result).toMatchObject({ ok: true, mode: 'in-process' });
    expect(mocks.resolveService).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith(expect.objectContaining({ service }));
    expect(trigger).toHaveBeenCalledOnce();
  });

  it('still retires the old process if refreshing the supervisor configuration fails', async () => {
    vi.stubEnv('XOPC_SERVICE_MARKER', '1');
    mocks.refresh.mockRejectedValue(new Error('permission denied'));
    const trigger = vi.fn(() => ({ ok: true }));
    const result = await maybeRestartGatewayAfterUpdate({
      preparedService: service, triggerInProcessRestart: trigger, updatedPackageRoot: '/updated', expectedVersion: '2.0.0',
    });
    expect(result).toMatchObject({ ok: true, mode: 'in-process', warning: expect.stringContaining('permission denied') });
    expect(trigger).toHaveBeenCalledOnce();
  });

  it('restarts a foreground gateway directly without looking up a daemon', async () => {
    vi.stubEnv('XOPC_SERVICE_MARKER', '');
    const trigger = vi.fn(() => ({ ok: true }));
    await expect(maybeRestartGatewayAfterUpdate({ triggerInProcessRestart: trigger })).resolves.toMatchObject({ ok: true });
    expect(mocks.resolveService).not.toHaveBeenCalled();
  });

  it('honors disabled restart before loading a platform module or exiting', async () => {
    mocks.loadConfig.mockReturnValue({ commands: { restart: false } });
    expect(await prepareGatewayRestart()).toBeUndefined();
    const trigger = vi.fn(() => ({ ok: true }));
    expect(await maybeRestartGatewayAfterUpdate({ triggerInProcessRestart: trigger })).toMatchObject({ ok: false, mode: 'disabled' });
    expect(trigger).not.toHaveBeenCalled();
    expect(mocks.resolveService).not.toHaveBeenCalled();
  });

  it.each([
    ['starting', { status: 'starting', ready: false }, '2.0.0'],
    ['old version', { status: 'ok', ready: true }, '1.0.0'],
    ['missing version', { status: 'ok', ready: true }, undefined],
  ])('does not claim success for %s after daemon restart', async (_label, health, version) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/api/health') ? health : { version })));
    vi.stubGlobal('fetch', fetchMock);
    const pending = maybeRestartGatewayAfterUpdate({ preparedService: service, expectedVersion: '2.0.0' });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: false, mode: 'failed' });
  });

  it('checks the authenticated running version after the public readiness probe', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/api/health') ? { status: 'ok', ready: true } : { version: '2.0.0' })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await maybeRestartGatewayAfterUpdate({ preparedService: service, expectedVersion: '2.0.0' })).toMatchObject({ ok: true, mode: 'daemon' });
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:19876/api/status', expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }));
  });
});
