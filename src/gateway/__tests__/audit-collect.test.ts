import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  collectGatewayConfigFindings,
  collectGatewaySecurityFindings,
  collectGatewayStartupGuardFindings,
} from '../security/audit.js';

function baseConfig(overrides: Partial<Config['gateway']> = {}): Config {
  return {
    gateway: {
      bind: 'loopback',
      port: 18790,
      auth: { mode: 'token', token: 'a'.repeat(32) },
      corsOrigins: [],
      ...overrides,
    },
  } as Config;
}

describe('collectGatewaySecurityFindings', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does not report a persisted desktop token as temporary without an environment token', () => {
    vi.stubEnv('XOPC_GATEWAY_TOKEN', '');
    const findings = collectGatewaySecurityFindings(baseConfig(), {});
    expect(findings.some((f) => f.checkId === 'gateway.auth.auto_generated_token')).toBe(false);
  });

  it('does not report an environment token as temporary', () => {
    vi.stubEnv('XOPC_GATEWAY_TOKEN', '');
    const findings = collectGatewaySecurityFindings(baseConfig({ auth: { mode: 'token' } }), {
      XOPC_GATEWAY_TOKEN: 'stable-environment-token-123456789',
    });
    expect(findings.some((f) => f.checkId === 'gateway.auth.auto_generated_token')).toBe(false);
  });

  it('reports a temporary token using the supplied environment instead of process.env', () => {
    vi.stubEnv('XOPC_GATEWAY_TOKEN', 'unrelated-process-token-123456789');
    const findings = collectGatewaySecurityFindings(baseConfig({ auth: { mode: 'token' } }), {});
    expect(findings.find((f) => f.checkId === 'gateway.auth.auto_generated_token')).toMatchObject({
      severity: 'info',
      detail: expect.stringContaining('change on each restart'),
      remediation: expect.stringContaining('gateway.auth.token'),
    });
  });

  it('passes loopback token config without startup guard failure', () => {
    const findings = collectGatewaySecurityFindings(baseConfig());
    expect(findings.some((f) => f.checkId === 'gateway.runtime_config.blocked')).toBe(false);
  });

  it('accepts automatically resolved origins on a lan bind', () => {
    const cfg = baseConfig({
      bind: 'lan',
      corsOrigins: [],
    });
    const findings = collectGatewaySecurityFindings(cfg);
    expect(findings.some((f) => f.checkId === 'gateway.runtime_config.blocked')).toBe(false);
    expect(findings.some((f) => f.checkId.startsWith('gateway.cors.'))).toBe(false);
  });

  it('reports trusted-proxy missing proxies on network bind', () => {
    const cfg = baseConfig({
      bind: 'lan',
      corsOrigins: ['https://gw.example.com'],
      auth: {
        mode: 'trusted-proxy',
        trustedProxy: { userHeader: 'x-forwarded-user' },
      },
    });
    const findings = collectGatewaySecurityFindings(cfg);
    expect(findings.some((f) => f.checkId === 'gateway.trusted_proxy_no_proxies')).toBe(true);
    expect(findings.some((f) => f.checkId === 'gateway.runtime_config.blocked')).toBe(true);
  });

  it('warns about missing TLS on network bind without tunnel', () => {
    const findings = collectGatewayConfigFindings({
      auth: { mode: 'token', token: 'b'.repeat(32) },
      bindHost: '0.0.0.0',
      corsOrigins: ['http://192.168.1.10:18790'],
      tlsEnabled: false,
    });
    expect(findings.some((f) => f.checkId === 'gateway.transport.no_tls')).toBe(true);
  });
});

describe('collectGatewayStartupGuardFindings', () => {
  it('returns empty array when config passes guards', () => {
    expect(collectGatewayStartupGuardFindings(baseConfig())).toEqual([]);
  });

  it('returns blocked finding when strict security lacks rate limit config', () => {
    const cfg = baseConfig({
      bind: 'lan',
      corsOrigins: ['http://192.168.1.10:18790'],
      security: { strict: true },
    });
    const findings = collectGatewayStartupGuardFindings(cfg);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.checkId).toBe('gateway.runtime_config.blocked');
  });
});
