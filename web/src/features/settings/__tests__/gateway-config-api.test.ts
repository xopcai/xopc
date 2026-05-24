import { describe, expect, it } from 'vitest';

import {
  isMaskedGatewaySecret,
  normalizeGatewayFromConfig,
} from '../gateway-config-api';
import { DEFAULT_AUTH_RATE_LIMIT, DEFAULT_GATEWAY_PORT, DEFAULT_MAX_SSE_CONNECTIONS } from '../gateway-settings.types';

describe('normalizeGatewayFromConfig', () => {
  it('maps gateway auth, listen, cors, and rate limit fields', () => {
    const state = normalizeGatewayFromConfig({
      gateway: {
        bind: 'lan',
        host: '0.0.0.0',
        port: 18800,
        corsOrigins: ['http://localhost:5173'],
        auth: {
          mode: 'password',
          password: '••••••••••••',
          rateLimit: {
            enabled: false,
            maxAttempts: 3,
            windowMs: 600_000,
            blockDurationMs: 120_000,
          },
        },
      },
      update: { channel: 'beta' },
    });
    expect(state.bind).toBe('lan');
    expect(state.host).toBe('0.0.0.0');
    expect(state.port).toBe(18800);
    expect(state.corsOrigins).toEqual(['http://localhost:5173']);
    expect(state.auth.mode).toBe('password');
    expect(state.auth.password).toBe('••••••••••••');
    expect(state.auth.rateLimit.enabled).toBe(false);
    expect(state.auth.rateLimit.maxAttempts).toBe(3);
    expect(state.updateChannel).toBe('beta');
  });

  it('uses defaults when gateway fields are missing', () => {
    const state = normalizeGatewayFromConfig({});
    expect(state.port).toBe(DEFAULT_GATEWAY_PORT);
    expect(state.bind).toBe('loopback');
    expect(state.corsOrigins).toEqual([]);
    expect(state.maxSseConnections).toBe(DEFAULT_MAX_SSE_CONNECTIONS);
    expect(state.channelConnectDeferMode).toBe('auto');
    expect(state.channelConnectDeferIds).toEqual([]);
    expect(state.channelConnectDeferSkipIds).toEqual([]);
    expect(state.auth.mode).toBe('token');
    expect(state.auth.rateLimit).toEqual(DEFAULT_AUTH_RATE_LIMIT);
  });
});

describe('isMaskedGatewaySecret', () => {
  it('detects masked sentinels', () => {
    expect(isMaskedGatewaySecret('***')).toBe(true);
    expect(isMaskedGatewaySecret('••••••••••••')).toBe(true);
    expect(isMaskedGatewaySecret('sk-live')).toBe(false);
  });
});
