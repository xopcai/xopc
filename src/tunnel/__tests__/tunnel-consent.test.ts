import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  assertTunnelMayStart,
  CURRENT_TUNNEL_CONSENT_VERSION,
  getTunnelConsentState,
  hasValidTunnelConsent,
  TunnelConsentError,
} from '../consent.js';
import { mergeTunnelConfigPatch, sanitizeTunnelConfig } from '../tunnel-config.js';

function baseConfig(overrides?: Partial<Config['tunnel']>): Config {
  return {
    tunnel: {
      enabled: false,
      brokerUrl: 'https://frp.xopc.ai/api',
      autoStart: false,
      ...overrides,
    },
  } as Config;
}

describe('tunnel consent', () => {
  it('requires matching consent version', () => {
    expect(hasValidTunnelConsent(baseConfig())).toBe(false);
    expect(
      hasValidTunnelConsent(
        baseConfig({
          consent: { version: '2020-01', acceptedAt: new Date().toISOString() },
        }),
      ),
    ).toBe(false);
    expect(
      hasValidTunnelConsent(
        baseConfig({
          consent: {
            version: CURRENT_TUNNEL_CONSENT_VERSION,
            acceptedAt: new Date().toISOString(),
          },
        }),
      ),
    ).toBe(true);
  });

  it('assertTunnelMayStart throws when consent missing', () => {
    expect(() => assertTunnelMayStart(baseConfig())).toThrow(TunnelConsentError);
  });

  it('getTunnelConsentState reflects canAutoStart', () => {
    const off = getTunnelConsentState(baseConfig());
    expect(off.consentRequired).toBe(true);
    expect(off.canAutoStart).toBe(false);

    const on = getTunnelConsentState(
      baseConfig({
        enabled: true,
        consent: {
          version: CURRENT_TUNNEL_CONSENT_VERSION,
          acceptedAt: new Date().toISOString(),
        },
      }),
    );
    expect(on.valid).toBe(true);
    expect(on.canAutoStart).toBe(true);
  });

  it('sanitizeTunnelConfig clears enabled and autoStart when consent invalid', () => {
    const cfg = baseConfig({
      enabled: true,
      autoStart: true,
      consent: { version: 'old', acceptedAt: new Date().toISOString() },
    });
    expect(sanitizeTunnelConfig(cfg)).toBe(true);
    expect(cfg.tunnel?.enabled).toBe(false);
    expect(cfg.tunnel?.autoStart).toBe(false);
  });

  it('sanitizeTunnelConfig clears enabled and autoStart when a public broker key is missing', () => {
    const cfg = baseConfig({
      enabled: true,
      autoStart: true,
      consent: {
        version: CURRENT_TUNNEL_CONSENT_VERSION,
        acceptedAt: new Date().toISOString(),
      },
    });
    expect(sanitizeTunnelConfig(cfg)).toBe(true);
    expect(cfg.tunnel?.enabled).toBe(false);
    expect(cfg.tunnel?.autoStart).toBe(false);
  });

  it('sanitizeTunnelConfig keeps local development tunnel flags without a key', () => {
    const cfg = baseConfig({
      enabled: true,
      autoStart: true,
      brokerUrl: 'http://127.0.0.1:7100/api',
      consent: {
        version: CURRENT_TUNNEL_CONSENT_VERSION,
        acceptedAt: new Date().toISOString(),
      },
    });
    expect(sanitizeTunnelConfig(cfg)).toBe(false);
    expect(cfg.tunnel?.enabled).toBe(true);
    expect(cfg.tunnel?.autoStart).toBe(true);
  });

  it('mergeTunnelConfigPatch rejects autoStart without enabled', () => {
    const cfg = baseConfig({
      consent: {
        version: CURRENT_TUNNEL_CONSENT_VERSION,
        acceptedAt: new Date().toISOString(),
      },
    });
    const result = mergeTunnelConfigPatch(cfg, { autoStart: true });
    expect(result.ok).toBe(false);
  });

  it('mergeTunnelConfigPatch stores registrationSecret and ignores masked sentinel', () => {
    const cfg = baseConfig();
    expect(mergeTunnelConfigPatch(cfg, { registrationSecret: 'broker-secret' }).ok).toBe(true);
    expect(cfg.tunnel?.registrationSecret).toBe('broker-secret');

    expect(mergeTunnelConfigPatch(cfg, { registrationSecret: '••••••••••••' }).ok).toBe(true);
    expect(cfg.tunnel?.registrationSecret).toBe('broker-secret');

    expect(mergeTunnelConfigPatch(cfg, { registrationSecret: null }).ok).toBe(true);
    expect(cfg.tunnel?.registrationSecret).toBeUndefined();
  });

  it('clearing the registration secret disables tunnel startup flags', () => {
    const cfg = baseConfig({
      enabled: true,
      autoStart: true,
      registrationSecret: 'broker-secret',
      consent: {
        version: CURRENT_TUNNEL_CONSENT_VERSION,
        acceptedAt: new Date().toISOString(),
      },
    });

    expect(mergeTunnelConfigPatch(cfg, { registrationSecret: null }).ok).toBe(true);
    expect(cfg.tunnel?.registrationSecret).toBeUndefined();
    expect(cfg.tunnel?.enabled).toBe(false);
    expect(cfg.tunnel?.autoStart).toBe(false);
  });

});
