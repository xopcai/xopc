import { describe, expect, it } from 'vitest';

import {
  isMaskedGatewaySecret,
  isNonLoopbackGatewayBind,
  normalizeGatewayFromConfig,
  validateGatewaySettings,
} from '../gateway-config-api';
import {
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_GATEWAY_PORT,
  DEFAULT_MAX_SSE_CONNECTIONS,
  DEFAULT_TRUSTED_PROXY,
} from '../gateway-settings.types';

describe('normalizeGatewayFromConfig', () => {
  it('maps gateway auth, listen, cors, security, and trusted-proxy fields', () => {
    const state = normalizeGatewayFromConfig({
      gateway: {
        bind: 'lan',
        port: 18800,
        corsOrigins: ['http://localhost:5173'],
        trustedProxies: ['10.0.0.0/8'],
        allowRealIpFallback: true,
        dangerouslyAllowHostHeaderOriginFallback: true,
        security: { strict: true },
        auth: {
          mode: 'trusted-proxy',
          rateLimit: {
            enabled: false,
            maxAttempts: 3,
            windowMs: 600_000,
            blockDurationMs: 120_000,
          },
          trustedProxy: {
            userHeader: 'X-Forwarded-User',
            requiredHeaders: ['X-Proxy-Auth'],
            allowUsers: ['alice'],
            allowLoopback: true,
          },
        },
      },
      update: { channel: 'beta' },
    });
    expect(state.bind).toBe('lan');
    expect(state.port).toBe(18800);
    expect(state.corsOrigins).toEqual(['http://localhost:5173']);
    expect(state.trustedProxies).toEqual(['10.0.0.0/8']);
    expect(state.allowRealIpFallback).toBe(true);
    expect(state.dangerouslyAllowHostHeaderOriginFallback).toBe(true);
    expect(state.securityStrict).toBe(true);
    expect(state.auth.mode).toBe('trusted-proxy');
    expect(state.auth.trustedProxy).toEqual({
      userHeader: 'X-Forwarded-User',
      requiredHeaders: ['X-Proxy-Auth'],
      allowUsers: ['alice'],
      allowLoopback: true,
    });
    expect(state.auth.rateLimit.enabled).toBe(false);
    expect(state.auth.rateLimit.maxAttempts).toBe(3);
    expect(state.updateChannel).toBe('beta');
    expect(state.updateCheckOnStart).toBe(true);
    expect(state.updateAutoEnabled).toBe(false);
  });

  it('maps update auto fields from config', () => {
    const state = normalizeGatewayFromConfig({
      update: {
        checkOnStart: false,
        auto: { enabled: true, stableDelayHours: 10, stableJitterHours: 4, betaCheckIntervalHours: 3 },
      },
    });
    expect(state.updateCheckOnStart).toBe(false);
    expect(state.updateAutoEnabled).toBe(true);
    expect(state.updateAutoStableDelayHours).toBe(10);
    expect(state.updateAutoStableJitterHours).toBe(4);
    expect(state.updateAutoBetaCheckIntervalHours).toBe(3);
  });

  it('maps gateway auth, listen, cors, and rate limit fields', () => {
    const state = normalizeGatewayFromConfig({
      gateway: {
        bind: 'lan',
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
    expect(state.auth.mode).toBe('password');
    expect(state.auth.password).toBe('••••••••••••');
    expect(state.auth.trustedProxy).toEqual(DEFAULT_TRUSTED_PROXY);
  });

  it('uses defaults when gateway fields are missing', () => {
    const state = normalizeGatewayFromConfig({});
    expect(state.port).toBe(DEFAULT_GATEWAY_PORT);
    expect(state.bind).toBe('loopback');
    expect(state.corsOrigins).toEqual([]);
    expect(state.trustedProxies).toEqual([]);
    expect(state.allowRealIpFallback).toBe(false);
    expect(state.dangerouslyAllowHostHeaderOriginFallback).toBe(false);
    expect(state.securityStrict).toBe(false);
    expect(state.maxSseConnections).toBe(DEFAULT_MAX_SSE_CONNECTIONS);
    expect(state.channelConnectDeferMode).toBe('auto');
    expect(state.channelConnectDeferIds).toEqual([]);
    expect(state.channelConnectDeferSkipIds).toEqual([]);
    expect(state.auth.mode).toBe('token');
    expect(state.auth.rateLimit).toEqual(DEFAULT_AUTH_RATE_LIMIT);
    expect(state.auth.trustedProxy).toEqual(DEFAULT_TRUSTED_PROXY);
  });
});

describe('isNonLoopbackGatewayBind', () => {
  it('treats loopback bind as local-only', () => {
    const state = normalizeGatewayFromConfig({ gateway: { bind: 'loopback' } });
    expect(isNonLoopbackGatewayBind(state)).toBe(false);
  });

  it('treats lan bind as network-accessible', () => {
    const state = normalizeGatewayFromConfig({ gateway: { bind: 'lan' } });
    expect(isNonLoopbackGatewayBind(state)).toBe(true);
  });
});

describe('validateGatewaySettings', () => {
  it('requires cors or host fallback on lan bind', () => {
    const state = normalizeGatewayFromConfig({
      gateway: { bind: 'lan', auth: { mode: 'token', token: 'secret' } },
    });
    expect(validateGatewaySettings(state)).toMatch(/CORS/i);
  });

  it('requires trusted proxies for trusted-proxy on lan bind', () => {
    const state = normalizeGatewayFromConfig({
      gateway: {
        bind: 'lan',
        corsOrigins: ['http://localhost:5173'],
        auth: {
          mode: 'trusted-proxy',
          trustedProxy: { userHeader: 'X-User' },
        },
      },
    });
    expect(validateGatewaySettings(state)).toMatch(/trusted-proxy/i);
  });

  it('passes valid lan token configuration', () => {
    const state = normalizeGatewayFromConfig({
      gateway: {
        bind: 'lan',
        corsOrigins: ['http://localhost:5173'],
        auth: { mode: 'token', token: 'secret' },
      },
    });
    expect(validateGatewaySettings(state)).toBeNull();
  });
});

describe('isMaskedGatewaySecret', () => {
  it('detects masked sentinels', () => {
    expect(isMaskedGatewaySecret('***')).toBe(true);
    expect(isMaskedGatewaySecret('••••••••••••')).toBe(true);
    expect(isMaskedGatewaySecret('sk-live')).toBe(false);
  });
});
