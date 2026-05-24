import { describe, expect, it } from 'vitest';

import { normalizeTunnelE2eFromConfig } from '../tunnel-e2e-api';

describe('normalizeTunnelE2eFromConfig', () => {
  it('maps tunnel.e2e fields', () => {
    const state = normalizeTunnelE2eFromConfig(
      {
        gateway: { port: 18800 },
        tunnel: { e2e: { enabled: false, tlsPort: 18801, staging: true } },
      },
      18800,
    );
    expect(state.enabled).toBe(false);
    expect(state.tlsPort).toBe(18801);
    expect(state.staging).toBe(true);
  });

  it('uses gateway port + 1 when legacy default tlsPort is stale', () => {
    const state = normalizeTunnelE2eFromConfig(
      {
        gateway: { port: 28790 },
        tunnel: { e2e: { tlsPort: 18791 } },
      },
      28790,
    );
    expect(state.tlsPort).toBe(28791);
  });
});
