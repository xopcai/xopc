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
  frpcDownload?: {
    phase: 'downloading' | 'extracting';
    bytesReceived?: number;
    totalBytes?: number | null;
    percent?: number | null;
  } | null;
  startProgress?: {
    phase:
      | 'preparing_frpc'
      | 'registering'
      | 'provisioning_tls'
      | 'starting_frpc'
      | 'reconnecting_frpc';
    startedAt: string;
    acmeStep?: 'checking' | 'dns_challenge' | 'dns_propagation' | 'ca_validation' | 'issuing' | null;
    publicUrl?: string | null;
  } | null;
  consentRequired?: boolean;
  canAutoStart?: boolean;
  consent?: {
    currentVersion: string;
    acceptedVersion: string | null;
    acceptedAt: string | null;
    valid: boolean;
  };
  registrationSecret?: {
    configured: boolean;
    source: 'env' | 'config' | 'dev_default' | 'missing';
  };
  config: {
    autoStart: boolean;
    brokerUrl: string;
    e2e?: {
      enabled: boolean;
      tlsPort: number;
      staging: boolean;
    };
  };
  cert?: {
    status: 'no_cert' | 'healthy' | 'expiring_soon' | 'critical' | 'renewal_failed';
    domain: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    daysUntilExpiry: number | null;
    autoRenewal: boolean;
    renewalFailed?: boolean;
    lastRenewalError?: string | null;
    lastRenewalErrorAt?: string | null;
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
  expiresAt?: string;
};

export type TunnelPairResponse = {
  pairingSecret: string;
  expiresAt: string;
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

export async function stopTunnel(opts?: { release?: boolean }): Promise<{ ok: boolean; released?: boolean }> {
  return fetchJson<{ ok: boolean; released?: boolean }>(apiUrl('/api/tunnel/stop'), {
    method: 'POST',
    body: JSON.stringify({ release: opts?.release === true }),
  });
}

export async function fetchTunnelQr(): Promise<TunnelQrResponse> {
  return fetchJson<TunnelQrResponse>(apiUrl('/api/tunnel/qr'));
}

export async function createTunnelPair(): Promise<TunnelPairResponse> {
  return fetchJson<TunnelPairResponse>(apiUrl('/api/tunnel/pair'), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function patchTunnelConfig(patch: {
  enabled?: boolean;
  autoStart?: boolean;
  brokerUrl?: string;
  registrationSecret?: string | null;
}): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ tunnel: patch }),
  });
}
