import { z } from 'zod';

import type { Config } from '../config/schema.js';
import { TunnelConfigSchema, TunnelConsentSchema } from '../config/schema.js';

import {
  assertTunnelAutoStartAllowed,
  buildTunnelConsentRecord,
  hasValidTunnelConsent,
} from './consent.js';
import { isMaskedTunnelSecretPatchValue } from './env.js';

const TunnelConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  brokerUrl: z.string().url().optional(),
  registrationSecret: z.union([z.string(), z.null()]).optional(),
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

  const patchFields = { ...parsed.data };
  if (parsed.data.registrationSecret !== undefined) {
    if (parsed.data.registrationSecret === null) {
      delete patchFields.registrationSecret;
    } else {
      const trimmed = parsed.data.registrationSecret.trim();
      if (!trimmed || isMaskedTunnelSecretPatchValue(trimmed)) {
        delete patchFields.registrationSecret;
      } else {
        patchFields.registrationSecret = trimmed;
      }
    }
  }

  const next = {
    ...(config.tunnel ?? TunnelConfigSchema.parse({})),
    ...patchFields,
  };

  if (parsed.data.registrationSecret === null) {
    delete next.registrationSecret;
  }

  if (parsed.data.autoStart === true) {
    const probeTunnel = TunnelConfigSchema.parse({ ...next, autoStart: true });
    const probe: Config = { ...config, tunnel: probeTunnel };
    try {
      assertTunnelAutoStartAllowed(probe);
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      return { ok: false, message: em };
    }
  }

  if (
    parsed.data.enabled === true &&
    !hasValidTunnelConsent({ ...config, tunnel: TunnelConfigSchema.parse(next) })
  ) {
    return {
      ok: false,
      message:
        'Cannot enable tunnel without accepting the security notice. Start remote access from settings or record consent first.',
    };
  }

  config.tunnel = TunnelConfigSchema.parse(next);
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

/**
 * Clear stale tunnel flags when consent is missing or outdated (Phase 2: config/runtime alignment).
 * Returns true when `config.tunnel` was modified.
 */
export function sanitizeTunnelConfig(config: Config): boolean {
  const tunnel = config.tunnel;
  if (!tunnel) return false;
  if (hasValidTunnelConsent(config)) return false;

  let changed = false;
  if (tunnel.enabled) {
    tunnel.enabled = false;
    changed = true;
  }
  if (tunnel.autoStart) {
    tunnel.autoStart = false;
    changed = true;
  }
  return changed;
}
