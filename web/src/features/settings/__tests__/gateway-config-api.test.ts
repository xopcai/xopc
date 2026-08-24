import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  gatewaySettingsRequireRestart,
  fetchGatewayCorsOriginCandidates,
  isMaskedGatewaySecret,
  isNonLoopbackGatewayBind,
  normalizeGatewayFromConfig,
  validateGatewaySettings,
} from '../gateway-config-api';
import {
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_GATEWAY_PORT,
  DEFAULT_TRUSTED_PROXY,
} from '../gateway-settings.types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchGatewayCorsOriginCandidates', () => {
  it('requests candidates for the selected gateway port', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: true,
      payload: {
        candidates: [{ url: 'http://192.168.1.8:28790', address: '192.168.1.8', interfaceName: 'en0' }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3000' } });

    await expect(fetchGatewayCorsOriginCandidates(28790)).resolves.toEqual([
      { url: 'http://192.168.1.8:28790', address: '192.168.1.8', interfaceName: 'en0' },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('port=28790');
  });
});

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
  it('allows lan bind without custom cors origins', () => {
    const state = normalizeGatewayFromConfig({
      gateway: { bind: 'lan', auth: { mode: 'token', token: 'secret' } },
    });
    expect(validateGatewaySettings(state)).toBeNull();
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

describe('gatewaySettingsRequireRestart', () => {
  it('returns false for identical settings', () => {
    const state = normalizeGatewayFromConfig({
      gateway: {
        bind: 'loopback',
        port: 18790,
        corsOrigins: ['http://localhost:5173'],
        auth: { mode: 'token', token: 'secret' },
      },
    });
    expect(gatewaySettingsRequireRestart(state, structuredClone(state))).toBe(false);
  });

  it('detects listen address changes', () => {
    const from = normalizeGatewayFromConfig({ gateway: { bind: 'loopback', port: 18790 } });
    const to = normalizeGatewayFromConfig({ gateway: { bind: 'lan', port: 18790 } });
    expect(gatewaySettingsRequireRestart(from, to)).toBe(true);
  });

  it('detects auth mode changes', () => {
    const from = normalizeGatewayFromConfig({ gateway: { auth: { mode: 'token', token: 'a' } } });
    const to = normalizeGatewayFromConfig({ gateway: { auth: { mode: 'password', password: 'b' } } });
    expect(gatewaySettingsRequireRestart(from, to)).toBe(true);
  });

  it('applies cors origin changes without a restart', () => {
    const from = normalizeGatewayFromConfig({ gateway: { corsOrigins: ['http://localhost:5173'] } });
    const to = normalizeGatewayFromConfig({ gateway: { corsOrigins: ['http://127.0.0.1:5173'] } });
    expect(gatewaySettingsRequireRestart(from, to)).toBe(false);
  });

  it('ignores masked secrets when auth mode is unchanged', () => {
    const from = normalizeGatewayFromConfig({ gateway: { auth: { mode: 'token', token: '***' } } });
    const to = normalizeGatewayFromConfig({ gateway: { auth: { mode: 'token', token: '••••••••••••' } } });
    expect(gatewaySettingsRequireRestart(from, to)).toBe(false);
  });

  it('ignores update channel changes', () => {
    const from = normalizeGatewayFromConfig({ update: { channel: 'stable' } });
    const to = normalizeGatewayFromConfig({ update: { channel: 'beta' } });
    expect(gatewaySettingsRequireRestart(from, to)).toBe(false);
  });
});
