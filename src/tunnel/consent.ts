import type { Config } from '../config/schema.js';

/** Bump when risk copy or terms change; users must re-accept. */
export const CURRENT_TUNNEL_CONSENT_VERSION = '2026-05';

/** Bump when Tailscale Serve risk copy changes. */
export const CURRENT_TAILSCALE_CONSENT_VERSION = '2026-05-serve';

export function hasValidTailscaleConsent(config: Config): boolean {
  const consent = config.gateway?.tailscale?.consent;
  if (!consent?.acceptedAt?.trim()) return false;
  return consent.version === CURRENT_TAILSCALE_CONSENT_VERSION;
}

export function buildTailscaleConsentRecord() {
  return {
    version: CURRENT_TAILSCALE_CONSENT_VERSION,
    acceptedAt: new Date().toISOString(),
  };
}

export const TUNNEL_CONSENT_REQUIRED_CODE = 'TUNNEL_CONSENT_REQUIRED';

export class TunnelConsentError extends Error {
  readonly code = TUNNEL_CONSENT_REQUIRED_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'TunnelConsentError';
  }
}

export type TunnelConsentState = {
  valid: boolean;
  consentRequired: boolean;
  acceptedAt: string | null;
  acceptedVersion: string | null;
  currentVersion: string;
  canAutoStart: boolean;
};

export function hasValidTunnelConsent(config: Config): boolean {
  const consent = config.tunnel?.consent;
  if (!consent?.acceptedAt?.trim()) return false;
  return consent.version === CURRENT_TUNNEL_CONSENT_VERSION;
}

export function getTunnelConsentState(config: Config): TunnelConsentState {
  const consent = config.tunnel?.consent;
  const valid = hasValidTunnelConsent(config);
  const enabled = config.tunnel?.enabled === true;
  return {
    valid,
    consentRequired: !valid,
    acceptedAt: consent?.acceptedAt ?? null,
    acceptedVersion: consent?.version ?? null,
    currentVersion: CURRENT_TUNNEL_CONSENT_VERSION,
    canAutoStart: valid && enabled,
  };
}

/** Gate tunnel start and autostart paths. */
export function assertTunnelMayStart(config: Config): void {
  if (!hasValidTunnelConsent(config)) {
    throw new TunnelConsentError(
      `Remote access requires accepting the security notice (version ${CURRENT_TUNNEL_CONSENT_VERSION}). ` +
        'Use the gateway settings page or `xopc tunnel start --accept-risk` after reading the risks.',
    );
  }
}

export function assertTunnelAutoStartAllowed(config: Config): void {
  assertTunnelMayStart(config);
  if (config.tunnel?.enabled !== true) {
    throw new TunnelConsentError(
      'tunnel.autoStart requires remote access to be enabled (start the tunnel once from settings or CLI).',
    );
  }
}

export function buildTunnelConsentRecord(): NonNullable<Config['tunnel']>['consent'] {
  return {
    version: CURRENT_TUNNEL_CONSENT_VERSION,
    acceptedAt: new Date().toISOString(),
  };
}

/** Short risk summary for CLI (keep in sync with web i18n). */
export const TUNNEL_RISK_SUMMARY_LINES = [
  'Starting remote access exposes your gateway on the public internet via frp.xopc.ai.',
  'Anyone with the public URL or pairing QR may use your gateway Bearer token.',
  'Traffic is proxied through third-party infrastructure; use a strong token and stop the tunnel when not needed.',
] as const;
