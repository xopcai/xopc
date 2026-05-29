import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  getTunnelRegistrationSecretMeta,
  isMaskedTunnelSecretPatchValue,
  isProductionTunnelBroker,
  maskTunnelSecretForWeb,
  readTunnelRegistrationSecretFromConfigOnly,
  resolveTunnelRegistrationSecret,
} from '../env.js';

describe('resolveTunnelRegistrationSecret', () => {
  it('prefers env over config and dev default', () => {
    expect(
      resolveTunnelRegistrationSecret(
        { XOPC_TUNNEL_REGISTRATION_SECRET: 'prod-secret' },
        'https://frp.xopc.ai/api',
        'config-secret',
      ),
    ).toBe('prod-secret');
  });

  it('uses config secret when env is unset', () => {
    expect(
      resolveTunnelRegistrationSecret({}, 'https://frp.xopc.ai/api', 'from-config'),
    ).toBe('from-config');
  });

  it('allows dev default for localhost broker', () => {
    expect(
      resolveTunnelRegistrationSecret({}, 'http://127.0.0.1:7100/api'),
    ).toBe('dev-registration-secret');
  });

  it('requires env or config for production broker host', () => {
    expect(() =>
      resolveTunnelRegistrationSecret({}, 'https://frp.xopc.ai/api'),
    ).toThrow(/registration secret/i);
  });
});

describe('getTunnelRegistrationSecretMeta', () => {
  it('reports env source when env is set', () => {
    expect(
      getTunnelRegistrationSecretMeta(
        { tunnel: { registrationSecret: 'cfg' } } as Config,
        { XOPC_TUNNEL_REGISTRATION_SECRET: 'env' },
      ),
    ).toEqual({ configured: true, source: 'env' });
  });

  it('reports config source when only config is set', () => {
    expect(
      getTunnelRegistrationSecretMeta(
        { tunnel: { registrationSecret: 'cfg' } } as Config,
        {},
        'https://frp.xopc.ai/api',
      ),
    ).toEqual({ configured: true, source: 'config' });
  });

  it('reports missing for production broker without secret', () => {
    expect(
      getTunnelRegistrationSecretMeta(undefined, {}, 'https://frp.xopc.ai/api'),
    ).toEqual({ configured: false, source: 'missing' });
  });
});

describe('maskTunnelSecretForWeb', () => {
  it('masks with bullets matching secret length', () => {
    expect(maskTunnelSecretForWeb('abc')).toBe('•••');
    expect(maskTunnelSecretForWeb('broker-secret-12345')).toBe('•'.repeat('broker-secret-12345'.length));
  });
});

describe('isMaskedTunnelSecretPatchValue', () => {
  it('accepts legacy sentinels and variable-length bullet masks', () => {
    expect(isMaskedTunnelSecretPatchValue('***')).toBe(true);
    expect(isMaskedTunnelSecretPatchValue('••••••••••••')).toBe(true);
    expect(isMaskedTunnelSecretPatchValue('••••••••••••••••••••')).toBe(true);
    expect(isMaskedTunnelSecretPatchValue('real-secret')).toBe(false);
  });
});

describe('readTunnelRegistrationSecretFromConfigOnly', () => {
  it('returns trimmed config secret', () => {
    expect(
      readTunnelRegistrationSecretFromConfigOnly({
        tunnel: { registrationSecret: '  key-123  ' },
      } as Config),
    ).toBe('key-123');
  });

  it('returns null when unset', () => {
    expect(readTunnelRegistrationSecretFromConfigOnly(undefined)).toBeNull();
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
