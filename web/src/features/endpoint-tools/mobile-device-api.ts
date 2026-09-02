import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type MobileDevice = {
  id: string;
  displayName: string;
  platform: 'ios' | 'android';
  scopes: string[];
  createdAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
};

export type MobilePairingSetup = {
  id: string;
  universalLink: string;
  expiresAt: number;
  routes: Array<{
    id: string;
    kind: 'xopc-secure-link' | 'tailscale' | 'custom-https';
    url: string;
  }>;
};

export type MobilePairingCreation =
  | { kind: 'ready'; setup: MobilePairingSetup }
  | { kind: 'needs-secure-route' };

export type MobilePairingReadiness = {
  ready: boolean;
  routes: MobilePairingSetup['routes'];
};

export async function fetchMobileDevices(): Promise<MobileDevice[]> {
  const response = await fetchJson<{ ok: true; devices: MobileDevice[] }>(apiUrl('/api/devices'));
  return response.devices;
}

export async function fetchMobilePairingReadiness(): Promise<MobilePairingReadiness> {
  const response = await fetchJson<{ ok: true } & MobilePairingReadiness>(
    apiUrl('/api/device-pairing/readiness'),
  );
  return { ready: response.ready, routes: response.routes };
}

export async function createMobilePairingSetup(): Promise<MobilePairingCreation> {
  try {
    const response = await fetchJson<{ ok: true; setup: MobilePairingSetup }>(
      apiUrl('/api/device-pairing/setups'),
      { method: 'POST', body: JSON.stringify({}) },
    );
    return { kind: 'ready', setup: response.setup };
  } catch (error) {
    const code = (error as { body?: { error?: { code?: unknown } } }).body?.error?.code;
    if (code === 'NO_SECURE_ROUTE') return { kind: 'needs-secure-route' };
    throw error;
  }
}

export async function revokeMobileDevice(deviceId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/devices/${encodeURIComponent(deviceId)}`), { method: 'DELETE' });
}
