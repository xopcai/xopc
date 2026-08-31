import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  getTunnelRegistrationSecretMeta,
  isMaskedTunnelSecretPatchValue,
  isLocalDevelopmentTunnelBroker,
  maskTunnelSecretForWeb,
  readTunnelRegistrationSecretFromConfigOnly,
  resolveOptionalTunnelRegistrationSecret,
  resolveTunnelRegistrationSecret,
  TunnelRegistrationSecretError,
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
    ).toThrow(TunnelRegistrationSecretError);
  });

  it('requires config for a custom public broker', () => {
    expect(() =>
      resolveTunnelRegistrationSecret('https://broker.example.com/api'),
    ).toThrow(/registration secret/i);
  });

  it('resolves no startup secret when a public broker is not configured', () => {
    expect(
      resolveOptionalTunnelRegistrationSecret('https://frp.xopc.ai/api'),
    ).toBeUndefined();
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

  it('reports missing for a custom public broker without secret', () => {
    expect(
      getTunnelRegistrationSecretMeta(undefined, {}, 'https://broker.example.com/api'),
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

describe('isLocalDevelopmentTunnelBroker', () => {
  it('does not treat frp.xopc.ai as local development', () => {
    expect(isLocalDevelopmentTunnelBroker('https://frp.xopc.ai/api')).toBe(false);
  });

  it('detects localhost', () => {
    expect(isLocalDevelopmentTunnelBroker('http://localhost:7100')).toBe(true);
  });

  it('does not treat an arbitrary public broker as local development', () => {
    expect(isLocalDevelopmentTunnelBroker('https://broker.example.com/api')).toBe(false);
  });
});
