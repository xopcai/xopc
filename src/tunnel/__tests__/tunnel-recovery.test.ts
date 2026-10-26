import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TunnelBrokerClient, TunnelBrokerError, TunnelRecoveryProofRejectedError } from '../broker-client.js';
import { persistedFromRegistration } from '../tunnel-persist.js';
import * as tunnelState from '../tunnel-state.js';
import { loadTunnelState, saveTunnelState } from '../tunnel-state.js';
import { TunnelService } from '../tunnel-service.js';
import type { TunnelRegistration } from '../tunnel-types.js';

vi.mock('../frpc-binary.js', () => ({ ensureFrpcBinary: vi.fn(async () => '/tmp/frpc'),
  publishFrpcPathForProcess: vi.fn(), clearFrpcPathForProcess: vi.fn() }));
vi.mock('../frpc-process.js', () => ({ spawnFrpcProcess: vi.fn(() => ({ pid: 123,
  waitForLoginSuccess: Promise.resolve(), onExit: vi.fn(), kill: vi.fn(async () => {}) })) }));

const registration: TunnelRegistration = {
  tunnelId: 'new-lease', tunnelToken: 'new-token', subdomain: 'stable', publicUrl: 'https://stable.frp.xopc.ai',
  frpc: { authToken: 'new-frpc-token', proxyName: 'gw-backend', subdomain: 'backend', serverAddr: 'frp.xopc.ai', serverPort: 7000 },
  expiresAt: '2099-01-01T00:00:00.000Z', heartbeatIntervalMs: 30_000,
};

describe('TunnelService lease recovery', () => {
  let service: TunnelService;
  let stateDir: string;
  let previousStateDir: string | undefined;
  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-tunnel-recovery-'));
    process.env.XOPC_STATE_DIR = stateDir;
    service = new TunnelService();
    service.configure({ brokerUrl: 'https://frp.xopc.ai/api', registrationSecret: 'valid-key', autoStart: false,
      gatewayHost: '127.0.0.1', frpSubdomainHost: 'frp.xopc.ai' });
    vi.spyOn(TunnelBrokerClient.prototype, 'heartbeat').mockResolvedValue();
  });
  afterEach(async () => {
    await service.stop();
    vi.restoreAllMocks();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('recovers missing credentials only after an explicit request and persists replacement credentials', async () => {
    const register = vi.spyOn(TunnelBrokerClient.prototype, 'register').mockRejectedValue(new TunnelRecoveryProofRejectedError());
    const recover = vi.spyOn(TunnelBrokerClient.prototype, 'recover').mockResolvedValue(registration);
    await expect(service.start(18790, 'gateway-token')).rejects.toBeInstanceOf(TunnelRecoveryProofRejectedError);
    expect(recover).not.toHaveBeenCalled();
    await service.start(18790, 'gateway-token', { recoverActiveLease: true });
    expect(register).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
    expect(loadTunnelState()).toMatchObject({ tunnelId: 'new-lease', tunnelToken: 'new-token' });
    expect(service.getStatus()).toMatchObject({ state: 'connected', publicUrl: registration.publicUrl });
  });

  it.each([401, 403, 410])('re-registers with the new key after persisted heartbeat is rejected with %s', async (status) => {
    saveTunnelState(persistedFromRegistration({ ...registration, tunnelId: 'old-lease', tunnelToken: 'old-token' }));
    vi.mocked(TunnelBrokerClient.prototype.heartbeat).mockRejectedValueOnce(new TunnelBrokerError(status, 'Old lease rejected'));
    const register = vi.spyOn(TunnelBrokerClient.prototype, 'register').mockResolvedValue(registration);
    await service.start(18790, 'gateway-token');
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ registrationSecret: 'valid-key', recoveryToken: 'old-token' }));
    expect(service.getStatus().state).toBe('connected');
  });

  it('does not replace a lease on a transient heartbeat failure', async () => {
    saveTunnelState(persistedFromRegistration(registration));
    vi.mocked(TunnelBrokerClient.prototype.heartbeat).mockRejectedValueOnce(new Error('Network unavailable'));
    const register = vi.spyOn(TunnelBrokerClient.prototype, 'register');
    await expect(service.start(18790, 'gateway-token')).rejects.toThrow('Network unavailable');
    expect(register).not.toHaveBeenCalled();
    expect(loadTunnelState()?.tunnelToken).toBe(registration.tunnelToken);
  });

  it('exits connecting state when saving newly issued credentials fails and allows explicit recovery', async () => {
    vi.spyOn(TunnelBrokerClient.prototype, 'register').mockResolvedValue(registration);
    const recover = vi.spyOn(TunnelBrokerClient.prototype, 'recover').mockResolvedValue(registration);
    vi.spyOn(tunnelState, 'saveTunnelState').mockImplementationOnce(() => { throw new Error('Disk full'); });
    await expect(service.start(18790, 'gateway-token')).rejects.toThrow('Disk full');
    expect(service.getStatus()).toMatchObject({ state: 'error', lastError: 'Disk full', startProgress: null });
    await service.start(18790, 'gateway-token', { recoverActiveLease: true });
    expect(recover).toHaveBeenCalledOnce();
    expect(loadTunnelState()?.tunnelToken).toBe('new-token');
  });

  it('coalesces concurrent recovery requests so credentials are rotated only once', async () => {
    const recover = vi.spyOn(TunnelBrokerClient.prototype, 'recover').mockResolvedValue(registration);
    await Promise.all([service.start(18790, 'gateway-token', { recoverActiveLease: true }),
      service.start(18790, 'gateway-token', { recoverActiveLease: true })]);
    expect(recover).toHaveBeenCalledOnce();
  });
});
