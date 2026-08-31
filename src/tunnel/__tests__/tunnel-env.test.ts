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
  it('uses the configured secret', () => {
    expect(
      resolveTunnelRegistrationSecret('https://frp.xopc.ai/api', 'from-config'),
    ).toBe('from-config');
  });

  it('allows dev default for localhost broker', () => {
    expect(
      resolveTunnelRegistrationSecret('http://127.0.0.1:7100/api'),
    ).toBe('dev-registration-secret');
  });

  it('requires config for the production broker host', () => {
    expect(() =>
      resolveTunnelRegistrationSecret('https://frp.xopc.ai/api'),
    ).toThrow(/registration secret/i);
  });
});

describe('getTunnelRegistrationSecretMeta', () => {
  it('reports config source when configured', () => {
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
  it('accepts variable-length bullet masks', () => {
    expect(isMaskedTunnelSecretPatchValue('***')).toBe(false);
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
