import { createLogger } from '../utils/logger.js';

const log = createLogger('Tunnel');

export type TunnelWellKnownTransport = {
  tls: 'broker_terminated' | string;
  publicScheme?: string;
  requiresAppE2ee?: boolean;
};

export type TunnelWellKnownConfig = {
  brokerUrl: string;
  frp: {
    serverAddr: string;
    serverPort: number;
    subdomainHost: string;
  };
  frpcVersion: string;
  heartbeatIntervalMs: number;
  transport?: TunnelWellKnownTransport;
};

let cached: { origin: string; config: TunnelWellKnownConfig; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

function brokerOrigin(brokerUrl: string): string {
  const u = new URL(brokerUrl.replace(/\/+$/, '').replace(/\/api\/?$/, '') || brokerUrl);
  return u.origin;
}

/**
 * Fetch `/.well-known/tunnel-config` (broker URL, frp endpoints, frpc version).
 * Registration secret is never published here — use `XOPC_TUNNEL_REGISTRATION_SECRET`.
 */
export async function fetchTunnelWellKnown(brokerUrl: string): Promise<TunnelWellKnownConfig> {
  const origin = brokerOrigin(brokerUrl);
  if (cached && cached.origin === origin && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  const url = `${origin}/.well-known/tunnel-config`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Tunnel well-known fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as TunnelWellKnownConfig;
  cached = { origin, config: body, fetchedAt: Date.now() };
  log.debug({ url, brokerUrl: body.brokerUrl, transport: body.transport?.tls }, 'Loaded tunnel well-known config');
  return body;
}

export async function pingTunnelBroker(brokerUrl: string): Promise<boolean> {
  try {
    await fetchTunnelWellKnown(brokerUrl);
    return true;
  } catch {
    return false;
  }
}

export function clearTunnelWellKnownCache(): void {
  cached = null;
}
