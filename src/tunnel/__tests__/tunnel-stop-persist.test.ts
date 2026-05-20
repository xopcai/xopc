import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('tunnel stop persistence', () => {
  let prevStateDir: string | undefined;
  let stateDir: string;

  beforeEach(() => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-tunnel-stop-'));
    process.env.XOPC_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (prevStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = prevStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('updateTunnelState keeps subdomain when marking disabled', async () => {
    const { saveTunnelState, updateTunnelState, resolveTunnelStatePath } = await import(
      '../tunnel-state.js'
    );

    saveTunnelState({
      tunnelId: 't_test',
      tunnelToken: 'tok',
      subdomain: 'stable1',
      publicUrl: 'https://stable1.frp.xopc.ai',
      frpcAuthToken: 'frpc',
      registeredAt: new Date().toISOString(),
      enabled: true,
    });

    updateTunnelState({ enabled: false });

    const raw = JSON.parse(readFileSync(resolveTunnelStatePath(), 'utf8')) as {
      subdomain?: string;
      enabled?: boolean;
    };
    expect(raw.subdomain).toBe('stable1');
    expect(raw.enabled).toBe(false);
  });
});
