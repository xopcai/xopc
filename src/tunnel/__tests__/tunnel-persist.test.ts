import { describe, expect, it } from 'vitest';

import {
  canResumePersistedTunnel,
  persistedFromRegistration,
  registrationFromPersisted,
} from '../tunnel-persist.js';
import type { TunnelRegistration } from '../tunnel-types.js';

const sampleRegistration: TunnelRegistration = {
  tunnelId: 't_abc',
  tunnelToken: 'tok',
  subdomain: 'mygw01',
  publicUrl: 'https://mygw01.frp.xopc.ai',
  frpc: {
    serverAddr: 'frp.xopc.ai',
    serverPort: 7000,
    authToken: 'frpc-secret',
    proxyName: 'gw-mygw01',
  },
  expiresAt: '2026-12-31T00:00:00.000Z',
  heartbeatIntervalMs: 30_000,
};

describe('tunnel-persist', () => {
  it('round-trips registration through persisted state', () => {
    const persisted = persistedFromRegistration(sampleRegistration);
    expect(persisted.enabled).toBe(true);
    expect(persisted.frpcServerAddr).toBe('frp.xopc.ai');
    expect(canResumePersistedTunnel(persisted)).toBe(true);
    const resumed = registrationFromPersisted(persisted);
    expect(resumed?.subdomain).toBe('mygw01');
    expect(resumed?.frpc.authToken).toBe('frpc-secret');
  });

  it('cannot resume when frpc endpoint metadata is missing', () => {
    const partial = persistedFromRegistration(sampleRegistration);
    delete partial.frpcServerAddr;
    expect(canResumePersistedTunnel(partial)).toBe(false);
  });
});
