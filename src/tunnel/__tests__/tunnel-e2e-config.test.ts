import { describe, expect, it } from 'vitest';

import { resolveFrpSubdomainHost, resolveTunnelE2eConfig } from '../tunnel-e2e-config.js';

describe('tunnel-e2e-config', () => {
  it('defaults E2E to enabled with tlsPort 18791', () => {
    expect(resolveTunnelE2eConfig(undefined)).toEqual({
      enabled: true,
      tlsPort: 18791,
      staging: false,
    });
  });

  it('respects explicit overrides', () => {
    expect(
      resolveTunnelE2eConfig({
        enabled: false,
        brokerUrl: 'https://frp.xopc.ai/api',
        autoStart: false,
        e2e: { enabled: false, tlsPort: 19999, staging: true },
      }),
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
