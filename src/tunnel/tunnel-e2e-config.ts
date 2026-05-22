import type { TunnelConfig } from '../config/schema.js';

export type ResolvedTunnelE2eConfig = {
  enabled: boolean;
  tlsPort: number;
  staging: boolean;
};

export function resolveTunnelE2eConfig(tunnel?: TunnelConfig): ResolvedTunnelE2eConfig {
  const e2e = tunnel?.e2e;
  return {
    enabled: e2e?.enabled ?? true,
    tlsPort: e2e?.tlsPort ?? 18791,
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
