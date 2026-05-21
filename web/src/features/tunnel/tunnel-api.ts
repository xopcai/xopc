import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

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
  consent?: {
    currentVersion: string;
    acceptedVersion: string | null;
    acceptedAt: string | null;
    valid: boolean;
  };
  config: {
    autoStart: boolean;
    brokerUrl: string;
  };
};

export type TunnelStartResponse = {
  publicUrl: string | null;
  subdomain: string | null;
  qrPayload: string;
  lanUrl: string | null;
};

export type TunnelQrResponse = {
  qrPayload: string;
  publicUrl: string | null;
  lanUrl: string | null;
};

export async function fetchTunnelStatus(): Promise<TunnelStatusResponse> {
  return fetchJson<TunnelStatusResponse>(apiUrl('/api/tunnel/status'));
}

export async function recordTunnelConsent(): Promise<void> {
  await fetchJson(apiUrl('/api/tunnel/consent'), { method: 'POST', body: JSON.stringify({}) });
}

export async function startTunnel(): Promise<TunnelStartResponse> {
  return fetchJson<TunnelStartResponse>(apiUrl('/api/tunnel/start'), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function stopTunnel(): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(apiUrl('/api/tunnel/stop'), { method: 'POST' });
}

export async function fetchTunnelQr(): Promise<TunnelQrResponse> {
  return fetchJson<TunnelQrResponse>(apiUrl('/api/tunnel/qr'));
}

export async function patchTunnelConfig(patch: {
  enabled?: boolean;
  autoStart?: boolean;
  brokerUrl?: string;
}): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ tunnel: patch }),
  });
}
