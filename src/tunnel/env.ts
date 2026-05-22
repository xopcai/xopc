const DEV_REGISTRATION_SECRET = 'dev-registration-secret';

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

/**
 * Registration secret for Tunnel Broker register API.
 * Env `XOPC_TUNNEL_REGISTRATION_SECRET` always wins.
 * Dev default only for non-production brokers; production requires env.
 */
export function resolveTunnelRegistrationSecret(
  env: NodeJS.ProcessEnv = process.env,
  brokerUrl?: string,
): string {
  const fromEnv = env.XOPC_TUNNEL_REGISTRATION_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const effectiveUrl =
    brokerUrl ?? env.XOPC_TUNNEL_BROKER_URL ?? 'https://frp.xopc.ai/api';

  if (isProductionTunnelBroker(effectiveUrl)) {
    throw new Error(
      'XOPC_TUNNEL_REGISTRATION_SECRET is required for the production tunnel broker (frp.xopc.ai). ' +
        'Copy the value from the server .env or set it in your shell profile.',
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
