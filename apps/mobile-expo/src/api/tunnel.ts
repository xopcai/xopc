import { apiFetch } from './client';
import { useGatewayStore } from '../stores/gateway-store';

export type TunnelQrResponse = {
  qrPayload: string;
  publicUrl: string | null;
  lanUrl: string | null;
};

export type TunnelStatusResponse = {
  enabled: boolean;
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  subdomain: string | null;
  publicUrl: string | null;
  connectedSince: string | null;
  frpcPid: number | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  consentRequired?: boolean;
  canAutoStart?: boolean;
  config: {
    autoStart: boolean;
    brokerUrl: string;
  };
};

/** Returns null when unauthenticated, unreachable, or non-OK (silent for background sync). */
export async function fetchTunnelQr(): Promise<TunnelQrResponse | null> {
  const { token } = useGatewayStore.getState();
  if (!token.trim()) return null;

  try {
    const res = await apiFetch('/api/tunnel/qr');
    if (!res.ok) return null;
    return (await res.json()) as TunnelQrResponse;
  } catch {
    return null;
  }
}

/** Returns null when unauthenticated, unreachable, or non-OK (silent for background sync). */
export async function fetchTunnelStatus(): Promise<TunnelStatusResponse | null> {
  const { token } = useGatewayStore.getState();
  if (!token.trim()) return null;

  try {
    const res = await apiFetch('/api/tunnel/status');
    if (!res.ok) return null;
    return (await res.json()) as TunnelStatusResponse;
  } catch {
    return null;
  }
}
