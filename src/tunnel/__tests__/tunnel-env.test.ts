import { describe, expect, it } from 'vitest';

import { isProductionTunnelBroker, resolveTunnelRegistrationSecret } from '../env.js';

describe('resolveTunnelRegistrationSecret', () => {
  it('prefers env over dev default', () => {
    expect(
      resolveTunnelRegistrationSecret(
        { XOPC_TUNNEL_REGISTRATION_SECRET: 'prod-secret' },
        'https://frp.xopc.ai/api',
      ),
    ).toBe('prod-secret');
  });

  it('allows dev default for localhost broker', () => {
    expect(
      resolveTunnelRegistrationSecret({}, 'http://127.0.0.1:7100/api'),
    ).toBe('dev-registration-secret');
  });

  it('requires env for production broker host', () => {
    expect(() =>
      resolveTunnelRegistrationSecret({}, 'https://frp.xopc.ai/api'),
    ).toThrow(/XOPC_TUNNEL_REGISTRATION_SECRET/);
  });
});

describe('isProductionTunnelBroker', () => {
  it('detects frp.xopc.ai', () => {
    expect(isProductionTunnelBroker('https://frp.xopc.ai/api')).toBe(true);
  });

  it('treats localhost as non-production', () => {
    expect(isProductionTunnelBroker('http://localhost:7100')).toBe(false);
  });
});
