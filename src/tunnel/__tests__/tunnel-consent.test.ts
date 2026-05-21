import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  assertTunnelMayStart,
  CURRENT_TUNNEL_CONSENT_VERSION,
  getTunnelConsentState,
  hasValidTunnelConsent,
  TunnelConsentError,
} from '../consent.js';
import { mergeTunnelConfigPatch } from '../tunnel-config.js';

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
});
