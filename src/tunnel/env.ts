import type { Config } from '../config/schema.js';

const DEV_REGISTRATION_SECRET = 'dev-registration-secret';

export type TunnelRegistrationSecretSource = 'config' | 'dev_default' | 'missing';

export type TunnelRegistrationSecretMeta = {
  configured: boolean;
  source: TunnelRegistrationSecretSource;
};

export const TUNNEL_REGISTRATION_SECRET_REQUIRED_CODE =
  'TUNNEL_REGISTRATION_SECRET_REQUIRED';

export class TunnelRegistrationSecretError extends Error {
  readonly code = TUNNEL_REGISTRATION_SECRET_REQUIRED_CODE;

  constructor(brokerUrl?: string) {
    super(tunnelRegistrationSecretRequiredMessage(brokerUrl));
    this.name = 'TunnelRegistrationSecretError';
  }
}

function brokerHostname(brokerUrl: string): string | null {
  try {
    const normalized = brokerUrl.includes('://') ? brokerUrl : `https://${brokerUrl}`;
    return new URL(normalized.replace(/\/+$/, '')).hostname;
  } catch {
    return null;
  }
}

/** True only for brokers that are safe to use with the built-in development secret. */
export function isLocalDevelopmentTunnelBroker(brokerUrl: string): boolean {
  const host = brokerHostname(brokerUrl);
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  return host.endsWith('.local');
}

export function maskTunnelSecretForWeb(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) return '';
  return '•'.repeat(trimmed.length);
}

export function isMaskedTunnelSecretPatchValue(value: string): boolean {
  return /^•+$/.test(value);
}

function effectiveBrokerUrl(
  brokerUrl: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  return brokerUrl ?? env.XOPC_TUNNEL_BROKER_URL ?? 'https://frp.xopc.ai/api';
}

/**
 * Describe where the tunnel registration secret will be resolved from (no secret value returned).
 */
/** Plaintext registration secret from config file only (never env). */
export function readTunnelRegistrationSecretFromConfigOnly(
  config: Config | undefined,
): string | null {
  const secret = config?.tunnel?.registrationSecret?.trim();
  return secret || null;
}

export function getTunnelRegistrationSecretMeta(
  config: Config | undefined,
  env: NodeJS.ProcessEnv = process.env,
  brokerUrl?: string,
): TunnelRegistrationSecretMeta {
  if (config?.tunnel?.registrationSecret?.trim()) {
    return { configured: true, source: 'config' };
  }

  const effectiveUrl = effectiveBrokerUrl(brokerUrl ?? config?.tunnel?.brokerUrl, env);
  if (isLocalDevelopmentTunnelBroker(effectiveUrl)) {
    return { configured: true, source: 'dev_default' };
  }

  return { configured: false, source: 'missing' };
}

export function resolveOptionalTunnelRegistrationSecret(
  brokerUrl?: string,
  configSecret?: string,
): string | undefined {
  const fromConfig = configSecret?.trim();
  if (fromConfig) return fromConfig;

  const effectiveUrl = effectiveBrokerUrl(brokerUrl, process.env);
  return isLocalDevelopmentTunnelBroker(effectiveUrl) ? DEV_REGISTRATION_SECRET : undefined;
}

export function tunnelRegistrationSecretRequiredMessage(brokerUrl?: string): string {
  const effectiveUrl = effectiveBrokerUrl(brokerUrl, process.env);
  const host = brokerHostname(effectiveUrl);
  const brokerLabel =
    host === 'frp.xopc.ai'
      ? 'the XOPC public broker (frp.xopc.ai)'
      : `broker ${host ?? effectiveUrl}`;
  return (
    `Tunnel registration secret is required for ${brokerLabel}. ` +
    'Authorize XOPC from Remote access → Public internet, or create a Tunnel Registration Key at ' +
    'https://console.xopc.ai/access/client and save it there manually.'
  );
}

/**
 * Registration secret for Tunnel Broker register API.
 * Resolve `tunnel.registrationSecret` from config, with a development default for local brokers.
 */
export function resolveTunnelRegistrationSecret(
  brokerUrl?: string,
  configSecret?: string,
): string {
  const secret = resolveOptionalTunnelRegistrationSecret(brokerUrl, configSecret);
  if (secret) return secret;
  throw new TunnelRegistrationSecretError(brokerUrl);
}

export function resolveTunnelBrokerUrl(
  configBrokerUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.XOPC_TUNNEL_BROKER_URL ?? configBrokerUrl ?? 'https://frp.xopc.ai/api';
}
