import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { DevicePairingStatus, DevicePairingTargetKind } from '@xopcai/gateway-contract';

type DevicePairingSetupBase = {
  id: string;
  expiresAt: number;
  routes: Array<{
    id: string;
    kind: 'xopc-secure-link' | 'tailscale' | 'custom-https';
    url: string;
  }>;
};

export type DevicePairingSetup = DevicePairingSetupBase & (
  | { targetKind: 'mobile'; universalLink: string }
  | { targetKind: 'browser'; browserInvitation: string }
);

export type DevicePairingCreation =
  | { kind: 'ready'; setup: DevicePairingSetup }
  | { kind: 'needs-secure-route' };

export type DevicePairingReadiness = {
  protocolVersion: 3;
  ready: boolean;
  routes: DevicePairingSetup['routes'];
};

export async function fetchDevicePairingReadiness(): Promise<DevicePairingReadiness> {
  const response = await fetchJson<{ ok: true } & DevicePairingReadiness>(
    apiUrl('/api/device-pairing/readiness'),
  );
  return { ready: response.ready, routes: response.routes, protocolVersion: response.protocolVersion };
}

export async function createDevicePairingSetup(targetKind: DevicePairingTargetKind): Promise<DevicePairingCreation> {
  try {
    const response = await fetchJson<{ ok: true; setup: DevicePairingSetup }>(
      apiUrl('/api/device-pairing/setups'),
      { method: 'POST', body: JSON.stringify({ targetKind }) },
    );
    return { kind: 'ready', setup: response.setup };
  } catch (error) {
    const code = (error as { body?: { error?: { code?: unknown } } }).body?.error?.code;
    if (code === 'NO_SECURE_ROUTE') return { kind: 'needs-secure-route' };
    throw error;
  }
}

export async function fetchDevicePairingSetup(id: string): Promise<{ request: DevicePairingStatus | null; serverTime: number }> {
  return fetchJson(apiUrl(`/api/device-pairing/setups/${encodeURIComponent(id)}`));
}

export async function cancelDevicePairingSetup(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/device-pairing/setups/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export async function decideDevicePairing(request: DevicePairingStatus, decision: 'approve' | 'reject'): Promise<void> {
  await fetchJson(apiUrl(`/api/device-pairing/requests/${encodeURIComponent(request.requestId)}/decision`), {
    method: 'POST', body: JSON.stringify({ decision, expectedRevision: request.revision }),
  });
}

export async function downloadBrowserExtensionArchive(): Promise<void> {
  const response = await apiFetch(apiUrl('/api/browser/extension/archive'));
  if (!response.ok) throw new Error(`Browser extension download failed (${response.status})`);
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'xopc-browser-extension.zip';
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
