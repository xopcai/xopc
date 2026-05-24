import { describe, expect, it } from 'vitest';

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
      host: '127.0.0.1',
      port: 18790,
      auth: { mode: 'token', token: 'a'.repeat(32) },
      corsOrigins: [],
      ...overrides,
    },
  } as Config;
}

describe('collectGatewaySecurityFindings', () => {
  it('passes loopback token config without startup guard failure', () => {
    const findings = collectGatewaySecurityFindings(baseConfig());
    expect(findings.some((f) => f.checkId === 'gateway.runtime_config.blocked')).toBe(false);
  });

  it('reports startup guard failure for lan bind without cors', () => {
    const cfg = baseConfig({
      bind: 'lan',
      host: '0.0.0.0',
      corsOrigins: [],
    });
    const findings = collectGatewaySecurityFindings(cfg);
    expect(findings.some((f) => f.checkId === 'gateway.runtime_config.blocked')).toBe(true);
    expect(findings.some((f) => f.checkId === 'gateway.cors.no_explicit_origins')).toBe(true);
  });

  it('reports trusted-proxy missing proxies on network bind', () => {
    const cfg = baseConfig({
      bind: 'lan',
      host: '0.0.0.0',
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
      host: '0.0.0.0',
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
      host: '0.0.0.0',
      corsOrigins: ['http://192.168.1.10:18790'],
      security: { strict: true },
    });
    const findings = collectGatewayStartupGuardFindings(cfg);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.checkId).toBe('gateway.runtime_config.blocked');
  });
});
