import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TunnelBrokerClient } from '../broker-client.js';

describe('tunnel stop --release', () => {
  let prevStateDir: string | undefined;
  let stateDir: string;

  beforeEach(() => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-tunnel-release-'));
    process.env.XOPC_STATE_DIR = stateDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = prevStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stop with release deregisters and clears tunnel.json', async () => {
    const deregister = vi.spyOn(TunnelBrokerClient.prototype, 'deregister').mockResolvedValue(undefined);

    const { saveTunnelState, resolveTunnelStatePath } = await import('../tunnel-state.js');
    const { getTunnelService } = await import('../tunnel-service.js');

    saveTunnelState({
      tunnelId: 't_rel',
      tunnelToken: 'tok_rel',
      subdomain: 'abc123',
      publicUrl: 'https://abc123.frp.xopc.ai',
      frpcAuthToken: 'frpc',
      registeredAt: new Date().toISOString(),
      enabled: true,
    });

    const tunnel = getTunnelService();
    tunnel.configure({
      brokerUrl: 'https://frp.xopc.ai/api',
      registrationSecret: 'secret',
      autoStart: false,
      gatewayHost: '127.0.0.1',
    });

    const result = await tunnel.stop({ release: true });
    expect(result.released).toBe(true);
    expect(deregister).toHaveBeenCalledWith('t_rel', 'tok_rel');

    const raw = readFileSync(resolveTunnelStatePath(), 'utf8');
    expect(raw.trim()).toBe('{}');
  });
});
