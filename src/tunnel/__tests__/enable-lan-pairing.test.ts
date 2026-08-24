import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { applyLanPairingGatewayPatch } from '../enable-lan-pairing.js';

function baseConfig(overrides: Partial<Config['gateway']> = {}): Config {
  return {
    gateway: {
      bind: 'loopback',
      port: 28790,
      auth: { mode: 'token', token: 'a'.repeat(32) },
      corsOrigins: [],
      ...overrides,
    },
  } as Config;
}

describe('applyLanPairingGatewayPatch', () => {
  it('switches loopback gateway to lan bind without persisting derived origins', () => {
    const config = baseConfig();
    const result = applyLanPairingGatewayPatch(config);
    expect(result).toEqual({ ok: true, changed: true });
    expect(config.gateway?.bind).toBe('lan');
    expect(config.gateway?.corsOrigins).toEqual([]);
  });

  it('is idempotent when already on lan bind', () => {
    const config = baseConfig({ bind: 'lan', corsOrigins: [] });
    const result = applyLanPairingGatewayPatch(config);
    expect(result).toEqual({ ok: true, changed: false });
    expect(config.gateway?.corsOrigins).toEqual([]);
  });

  it('rejects when password auth is missing on network bind', () => {
    vi.stubEnv('XOPC_GATEWAY_PASSWORD', '');
    vi.stubEnv('XOPC_GATEWAY_TOKEN', '');
    const config = baseConfig({ auth: { mode: 'password' } });
    const result = applyLanPairingGatewayPatch(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/password/i);
    }
    expect(config.gateway?.bind).toBe('loopback');
    expect(config.gateway?.corsOrigins).toEqual([]);
  });
});
