import { describe, expect, it } from 'vitest';

import {
  LEGACY_DEFAULT_TUNNEL_TLS_PORT,
  resolveFrpSubdomainHost,
  resolveTunnelE2eConfig,
  resolveTunnelTlsPort,
} from '../tunnel-e2e-config.js';

describe('tunnel-e2e-config', () => {
  it('defaults E2E tlsPort to gatewayPort + 1', () => {
    expect(resolveTunnelE2eConfig(undefined, 18790)).toEqual({
      enabled: true,
      tlsPort: 18791,
      staging: false,
    });
    expect(resolveTunnelE2eConfig(undefined, 28790)).toEqual({
      enabled: true,
      tlsPort: 28791,
      staging: false,
    });
  });

  it('remaps legacy default tlsPort 18791 when gateway is not CLI default', () => {
    expect(
      resolveTunnelTlsPort(LEGACY_DEFAULT_TUNNEL_TLS_PORT, 28790),
    ).toBe(28791);
    expect(
      resolveTunnelTlsPort(LEGACY_DEFAULT_TUNNEL_TLS_PORT, 18790),
    ).toBe(18791);
  });

  it('respects explicit overrides', () => {
    expect(
      resolveTunnelE2eConfig(
        {
          enabled: false,
          brokerUrl: 'https://frp.xopc.ai/api',
          autoStart: false,
          e2e: { enabled: false, tlsPort: 19999, staging: true },
        },
        28790,
      ),
    ).toEqual({
      enabled: false,
      tlsPort: 19999,
      staging: true,
    });
  });

  it('derives frp subdomain host from broker URL', () => {
    expect(resolveFrpSubdomainHost('https://frp.xopc.ai/api')).toBe('frp.xopc.ai');
    expect(resolveFrpSubdomainHost('https://custom.example/api')).toBe('custom.example');
  });
});
