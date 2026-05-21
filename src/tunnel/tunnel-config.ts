import { z } from 'zod';

import type { Config } from '../config/schema.js';
import { TunnelConfigSchema, TunnelConsentSchema } from '../config/schema.js';

import {
  assertTunnelAutoStartAllowed,
  buildTunnelConsentRecord,
  hasValidTunnelConsent,
} from './consent.js';

const TunnelConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  brokerUrl: z.string().url().optional(),
  autoStart: z.boolean().optional(),
  subdomain: z.string().optional(),
  consent: TunnelConsentSchema.optional(),
});

export function mergeTunnelConfigPatch(
  config: Config,
  patch: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const parsed = TunnelConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }

  const next = {
    ...(config.tunnel ?? TunnelConfigSchema.parse({})),
    ...parsed.data,
  };

  if (parsed.data.autoStart === true) {
    const probe: Config = { ...config, tunnel: { ...next, autoStart: true } };
    try {
      assertTunnelAutoStartAllowed(probe);
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      return { ok: false, message: em };
    }
  }

  if (parsed.data.enabled === true && !hasValidTunnelConsent({ ...config, tunnel: next })) {
    return {
      ok: false,
      message:
        'Cannot enable tunnel without accepting the security notice. Start remote access from settings or record consent first.',
    };
  }

  config.tunnel = next;
  return { ok: true };
}

export function applyTunnelConsentToConfig(config: Config): void {
  if (!config.tunnel) {
    config.tunnel = TunnelConfigSchema.parse({});
  }
  config.tunnel.consent = buildTunnelConsentRecord();
}

export function setTunnelEnabledInConfig(config: Config, enabled: boolean): void {
  if (!config.tunnel) {
    config.tunnel = TunnelConfigSchema.parse({});
  }
  config.tunnel.enabled = enabled;
}
