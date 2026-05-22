import type { Config } from '../config/schema.js';

const DEV_REGISTRATION_SECRET = 'dev-registration-secret';

export const TUNNEL_MASKED_SECRET_SENTINELS = ['***', '••••••••••••'] as const;

export type TunnelRegistrationSecretSource = 'env' | 'config' | 'dev_default' | 'missing';

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

export function isMaskedTunnelSecretPatchValue(value: string): boolean {
  return (TUNNEL_MASKED_SECRET_SENTINELS as readonly string[]).includes(value);
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
export function getTunnelRegistrationSecretMeta(
  config: Config | undefined,
  env: NodeJS.ProcessEnv = process.env,
  brokerUrl?: string,
): TunnelRegistrationSecretMeta {
  if (env.XOPC_TUNNEL_REGISTRATION_SECRET?.trim()) {
    return { configured: true, source: 'env' };
  }

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
 * Priority: env `XOPC_TUNNEL_REGISTRATION_SECRET` → `tunnel.registrationSecret` in config → dev default (non-production brokers only).
 */
export function resolveTunnelRegistrationSecret(
  env: NodeJS.ProcessEnv = process.env,
  brokerUrl?: string,
  configSecret?: string,
): string {
  const fromEnv = env.XOPC_TUNNEL_REGISTRATION_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const fromConfig = configSecret?.trim();
  if (fromConfig) return fromConfig;

  const effectiveUrl = effectiveBrokerUrl(brokerUrl, env);

  if (isProductionTunnelBroker(effectiveUrl)) {
    throw new Error(
      'Tunnel registration secret is required for the production broker (frp.xopc.ai). ' +
        'Set XOPC_TUNNEL_REGISTRATION_SECRET or tunnel.registrationSecret in xopc.json (Remote access settings).',
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
