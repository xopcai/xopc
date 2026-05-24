import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type TunnelE2eState = {
  enabled: boolean;
  tlsPort: number;
  staging: boolean;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function resolveDefaultTlsPort(gatewayPort: number, rawTlsPort?: number): number {
  if (rawTlsPort === undefined) {
    return gatewayPort + 1;
  }
  if (rawTlsPort === 18791 && gatewayPort !== 18790) {
    return gatewayPort + 1;
  }
  return rawTlsPort;
}

export function normalizeTunnelE2eFromConfig(config: unknown, gatewayPort = 18790): TunnelE2eState {
  const c = isRecord(config) ? config : {};
  const tunnel = isRecord(c.tunnel) ? c.tunnel : {};
  const e2e = isRecord(tunnel.e2e) ? tunnel.e2e : {};
  const gw = isRecord(c.gateway) ? c.gateway : {};
  const port =
    typeof gw.port === 'number' && Number.isFinite(gw.port) ? Math.floor(gw.port) : gatewayPort;

  const rawTlsPort =
    typeof e2e.tlsPort === 'number' && Number.isFinite(e2e.tlsPort) ? Math.floor(e2e.tlsPort) : undefined;

  return {
    enabled: e2e.enabled !== false,
    tlsPort: resolveDefaultTlsPort(port, rawTlsPort),
    staging: e2e.staging === true,
  };
}

export function validateTunnelE2e(state: TunnelE2eState): string | null {
  if (state.tlsPort < 1024 || state.tlsPort > 65535) {
    return 'TLS port must be between 1024 and 65535.';
  }
  return null;
}

export async function patchTunnelE2e(state: TunnelE2eState): Promise<void> {
  const validationError = validateTunnelE2e(state);
  if (validationError) {
    throw new Error(validationError);
  }

  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      tunnel: {
        e2e: {
          enabled: state.enabled,
          tlsPort: state.tlsPort,
          staging: state.staging,
        },
      },
    }),
  });
  void revalidateGatewayConfig();
}
