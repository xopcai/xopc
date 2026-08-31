import type { Config } from '../config/schema.js';

const DEV_REGISTRATION_SECRET = 'dev-registration-secret';

export type TunnelRegistrationSecretSource = 'config' | 'dev_default' | 'missing';

export type TunnelRegistrationSecretMeta = {
  configured: boolean;
  source: TunnelRegistrationSecretSource;
};

function brokerHostname(brokerUrl: string): string | null {
  try {
    const normalized = brokerUrl.includes('://') ? brokerUrl : `https://${brokerUrl}`;
    return new URL(normalized.replace(/\/+$/, '')).hostname;
  } catch {
    return null;
  }
}

/** True when the broker is the public frp.xopc.ai service (not local dev). */
export function isProductionTunnelBroker(brokerUrl: string): boolean {
  const host = brokerHostname(brokerUrl);
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  if (host.endsWith('.local')) return false;
  return host === 'frp.xopc.ai';
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
  if (isProductionTunnelBroker(effectiveUrl)) {
    return { configured: false, source: 'missing' };
  }

  return { configured: true, source: 'dev_default' };
}

/**
 * Registration secret for Tunnel Broker register API.
 * Resolve `tunnel.registrationSecret` from config, with a development default for local brokers.
 */
export function resolveTunnelRegistrationSecret(
  brokerUrl?: string,
  configSecret?: string,
): string {
  const fromConfig = configSecret?.trim();
  if (fromConfig) return fromConfig;

  const effectiveUrl = effectiveBrokerUrl(brokerUrl, process.env);

  if (isProductionTunnelBroker(effectiveUrl)) {
    throw new Error(
      'Tunnel registration secret is required for the production broker (frp.xopc.ai). ' +
        'Authorize XOPC from Remote access → Public internet, or create a Tunnel Registration Key at ' +
        'https://console.xopc.ai/access/client and save it there manually.',
    );
  }

  return DEV_REGISTRATION_SECRET;
}

export function resolveTunnelBrokerUrl(
  configBrokerUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.XOPC_TUNNEL_BROKER_URL ?? configBrokerUrl ?? 'https://frp.xopc.ai/api';
}
