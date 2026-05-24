import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { assertGatewayRuntimeConfig } from '../runtime-config.js';
import type { ResolvedGatewayAuth } from '../auth.js';
import { resolveGatewayListenHost, resolveGatewayListenPlan } from '../listen.js';
import { buildDefaultCorsOrigins, isLoopbackHost } from '../host.js';

function baseConfig(overrides: Partial<Config['gateway']> = {}): Config {
  return {
    gateway: {
      bind: 'loopback',
      host: '127.0.0.1',
      port: 18790,
      auth: { mode: 'token', token: 'a'.repeat(32) },
      corsOrigins: [],
      ...overrides,
    },
  } as Config;
}

const tokenAuth: ResolvedGatewayAuth = {
  mode: 'token',
  token: 'b'.repeat(32),
};

describe('gateway listen helpers', () => {
  it('detects loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });

  it('resolves listen host with bind override', () => {
    const cfg = baseConfig({ bind: 'loopback', host: '127.0.0.1' });
    expect(resolveGatewayListenHost({ cfg, bindOverride: 'lan' })).toBe('0.0.0.0');
  });

  it('builds default cors origins for custom bind host', () => {
    expect(buildDefaultCorsOrigins({ port: 18790, bindHost: '192.168.1.10' })).toEqual([
      'http://localhost:18790',
      'http://127.0.0.1:18790',
      'http://192.168.1.10:18790',
    ]);
  });
});

describe('assertGatewayRuntimeConfig', () => {
  it('allows loopback bind with auth mode none', () => {
    const cfg = baseConfig({ auth: { mode: 'none' } });
    const result = assertGatewayRuntimeConfig({
      cfg,
      auth: { mode: 'none' },
      port: 18790,
    });
    expect(result.loopback).toBe(true);
    expect(result.bindMode).toBe('loopback');
  });

  it('refuses lan bind without corsOrigins', () => {
    const cfg = baseConfig({ bind: 'lan', host: '0.0.0.0', corsOrigins: [] });
    expect(() =>
      assertGatewayRuntimeConfig({
        cfg,
        auth: tokenAuth,
        port: 18790,
      }),
    ).toThrow(/gateway\.corsOrigins/);
  });

  it('allows lan bind with corsOrigins configured', () => {
    const cfg = baseConfig({
      bind: 'lan',
      host: '0.0.0.0',
      corsOrigins: ['http://192.168.1.10:18790'],
    });
    const result = assertGatewayRuntimeConfig({
      cfg,
      auth: tokenAuth,
      port: 18790,
    });
    expect(result.bindMode).toBe('lan');
    expect(result.bindHost).toBe('0.0.0.0');
  });

  it('uses CLI bind override for guard evaluation', () => {
    const cfg = baseConfig({ bind: 'loopback', corsOrigins: [] });
    expect(() =>
      assertGatewayRuntimeConfig({
        cfg,
        auth: tokenAuth,
        bindOverride: 'lan',
        port: 18790,
      }),
    ).toThrow(/gateway\.corsOrigins/);
  });

  it('requires customBindHost for bind=custom', () => {
    const cfg = baseConfig({ bind: 'custom', host: '127.0.0.1' });
    expect(() =>
      assertGatewayRuntimeConfig({
        cfg,
        auth: tokenAuth,
        port: 18790,
      }),
    ).toThrow(/customBindHost/);

    const ok = baseConfig({
      bind: 'custom',
      customBindHost: '192.168.1.5',
      host: '192.168.1.5',
      corsOrigins: ['http://192.168.1.5:18790'],
    });
    const plan = resolveGatewayListenPlan({ cfg: ok });
    expect(plan.bindHost).toBe('192.168.1.5');
    expect(() =>
      assertGatewayRuntimeConfig({
        cfg: ok,
        auth: tokenAuth,
        port: 18790,
      }),
    ).not.toThrow();
  });

  it('strict security requires explicit rateLimit on network bind', () => {
    const cfg = baseConfig({
      bind: 'lan',
      host: '0.0.0.0',
      corsOrigins: ['http://192.168.1.10:18790'],
      security: { strict: true },
    });
    expect(() =>
      assertGatewayRuntimeConfig({
        cfg,
        auth: tokenAuth,
        port: 18790,
      }),
    ).toThrow(/gateway\.auth\.rateLimit/);
  });

  it('allows lan bind for trusted-proxy when trustedProxies is configured', () => {
    const cfg = baseConfig({
      bind: 'lan',
      host: '0.0.0.0',
      corsOrigins: ['https://gateway.example.com'],
      trustedProxies: ['10.0.0.1'],
      auth: {
        mode: 'trusted-proxy',
        trustedProxy: { userHeader: 'x-forwarded-user' },
      },
    });
    const auth: ResolvedGatewayAuth = {
      mode: 'trusted-proxy',
      trustedProxy: { userHeader: 'x-forwarded-user' },
    };
    const result = assertGatewayRuntimeConfig({ cfg, auth, port: 18790 });
    expect(result.loopback).toBe(false);
    expect(result.auth.mode).toBe('trusted-proxy');
  });

  it('requires trustedProxies for trusted-proxy on network bind', () => {
    const cfg = baseConfig({
      bind: 'lan',
      host: '0.0.0.0',
      corsOrigins: ['https://gateway.example.com'],
      auth: {
        mode: 'trusted-proxy',
        trustedProxy: { userHeader: 'x-forwarded-user' },
      },
    });
    const auth: ResolvedGatewayAuth = {
      mode: 'trusted-proxy',
      trustedProxy: { userHeader: 'x-forwarded-user' },
    };
    expect(() => assertGatewayRuntimeConfig({ cfg, auth, port: 18790 })).toThrow(
      /trustedProxies/,
    );
  });
});
