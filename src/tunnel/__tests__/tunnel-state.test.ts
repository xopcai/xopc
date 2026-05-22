import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('tunnel-state', () => {
  let prevStateDir: string | undefined;
  let stateDir: string;

  beforeEach(() => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-tunnel-test-'));
    process.env.XOPC_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (prevStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = prevStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists and loads tunnel state', async () => {
    const { saveTunnelState, loadTunnelState, resolveTunnelStatePath } = await import('../tunnel-state.js');
    const state = {
      tunnelId: 't_test',
      tunnelToken: 'tok',
      subdomain: 'abc123',
      publicUrl: 'https://abc123.frp.xopc.ai',
      frpcAuthToken: 'frpc',
      registeredAt: new Date().toISOString(),
    };
    saveTunnelState(state);
    expect(existsSync(resolveTunnelStatePath())).toBe(true);
    expect(loadTunnelState()).toEqual(state);
  });
});
