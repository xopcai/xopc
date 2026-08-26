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
    url?: string;
    bytesReceived?: number;
    totalBytes?: number | null;
    percent?: number | null;
  } | null;
  startProgress?: {
    phase: 'preparing_frpc' | 'registering' | 'starting_frpc' | 'reconnecting_frpc';
    startedAt: string;
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
    transport?: { tls: 'broker_terminated' };
  };
};

export type TunnelStartResponse = {
  pairingSessionId?: string;
  publicUrl: string | null;
  subdomain: string | null;
  qrPayload: string;
  lanUrl: string | null;
};

export type TunnelQrResponse = {
  pairingSessionId?: string;
  qrPayload: string;
  publicUrl: string | null;
  lanUrl: string | null;
  expiresAt?: string;
};

export type TunnelPairResponse = {
  pairingSessionId: string;
  pairingSecret: string;
  expiresAt: string;
};

export type MobilePairCandidateKind = 'lan' | 'tunnel' | 'reverse-proxy';

export type MobilePairBlockReason = 'GATEWAY_LOOPBACK_ONLY' | 'NO_REACHABLE_URL';

export type MobilePairContextResponse = {
  port: number;
  bindMode: string;
  listenHost: string;
  pairingReady: boolean;
  blockReason?: MobilePairBlockReason;
  candidates: Array<{
    kind: MobilePairCandidateKind;
    url: string;
    label?: string;
    reachable: boolean;
    note?: string;
  }>;
  recommended: {
    mode: MobilePairCandidateKind | null;
    url: string | null;
  };
  connectUrls: string[];
};

export async function fetchTunnelPairContext(): Promise<MobilePairContextResponse> {
  return fetchJson<MobilePairContextResponse>(apiUrl('/api/tunnel/pair/context'));
}

export type EnableLanPairingResponse = {
  ok: boolean;
  requiresRestart: boolean;
  context: MobilePairContextResponse;
};

export async function enableLanMobilePairing(): Promise<EnableLanPairingResponse> {
  return fetchJson<EnableLanPairingResponse>(apiUrl('/api/tunnel/pair/enable-lan'), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

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

export async function revealTunnelRegistrationSecret(): Promise<{
  registrationSecret: string | null;
  source: 'config' | 'none';
}> {
  const data = await fetchJson<{
    ok?: boolean;
    payload?: { registrationSecret?: string | null; source?: 'config' | 'none' };
  }>(apiUrl('/api/tunnel/reveal-registration-secret'), {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const payload = data.payload;
  if (!payload) {
    throw new Error('Missing reveal payload');
  }
  return {
    registrationSecret: payload.registrationSecret ?? null,
    source: payload.source === 'config' ? 'config' : 'none',
  };
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
