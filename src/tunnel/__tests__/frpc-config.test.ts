import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeFrpcConfig } from '../frpc-config.js';
import type { TunnelRegistration } from '../tunnel-types.js';

describe('frpc-config', () => {
  let prevStateDir: string | undefined;
  let stateDir: string;

  beforeEach(() => {
    prevStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-frpc-config-'));
    process.env.XOPC_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (prevStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = prevStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  const registration: TunnelRegistration = {
    tunnelId: 't_test',
    tunnelToken: 'tok',
    subdomain: 'abc123',
    publicUrl: 'https://abc123.frp.xopc.ai',
    frpc: {
      serverAddr: 'frp.xopc.ai',
      serverPort: 7000,
      authToken: 'frpc-auth',
      proxyName: 'proxy_abc123',
    },
    expiresAt: new Date().toISOString(),
    heartbeatIntervalMs: 30_000,
  };

  it('writes http proxy by default', () => {
    writeFrpcConfig(registration, 18790);
    const path = join(stateDir, 'tmp', 'frpc-t_test.toml');
    const toml = readFileSync(path, 'utf8');
    expect(toml).toContain('type = "http"');
    expect(toml).toContain('localPort = 18790');
  });

  it('writes https proxy for E2E mode', () => {
    writeFrpcConfig(registration, 18791, '127.0.0.1', 'https');
    const path = join(stateDir, 'tmp', 'frpc-t_test.toml');
    const toml = readFileSync(path, 'utf8');
    expect(toml).toContain('type = "https"');
    expect(toml).toContain('localPort = 18791');
  });
});
