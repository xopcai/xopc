import type { TunnelConfig } from '../config/schema.js';

export type ResolvedTunnelE2eConfig = {
  enabled: boolean;
  tlsPort: number;
  staging: boolean;
};

/** Historical schema default — not suitable when gateway.port ≠ 18790 (e.g. Electron 28790). */
export const LEGACY_DEFAULT_TUNNEL_TLS_PORT = 18791;

export function resolveTunnelTlsPort(e2eTlsPort: number | undefined, gatewayPort: number): number {
  if (e2eTlsPort === undefined) {
    return gatewayPort + 1;
  }
  if (e2eTlsPort === LEGACY_DEFAULT_TUNNEL_TLS_PORT && gatewayPort !== 18790) {
    return gatewayPort + 1;
  }
  return e2eTlsPort;
}

export function resolveTunnelE2eConfig(
  tunnel?: TunnelConfig,
  gatewayPort = 18790,
): ResolvedTunnelE2eConfig {
  const e2e = tunnel?.e2e;
  return {
    enabled: e2e?.enabled ?? true,
    tlsPort: resolveTunnelTlsPort(e2e?.tlsPort, gatewayPort),
    staging: e2e?.staging ?? false,
  };
}

export function resolveFrpSubdomainHost(brokerUrl: string, override?: string): string {
  if (override?.trim()) return override.trim();
  try {
    const host = new URL(brokerUrl.replace(/\/api\/?$/, '')).hostname;
    if (host === 'frp.xopc.ai' || host.endsWith('.frp.xopc.ai')) return 'frp.xopc.ai';
    if (host.includes('.')) return host;
  } catch {
    /* fall through */
  }
  return 'frp.xopc.ai';
}
