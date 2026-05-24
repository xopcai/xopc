import { apiFetch } from '@/lib/fetch';

export type ExposureStatusResponse = {
  bindMode: string;
  tailscale: {
    mode: 'off' | 'serve' | 'funnel';
    active: boolean;
    hostname: string | null;
    resetOnExit: boolean;
    cliAvailable?: boolean;
  };
  tunnel: Record<string, unknown>;
  conflicts: Array<{ code: string; message: string }>;
};

export async function fetchExposureStatus(): Promise<ExposureStatusResponse> {
  const res = await apiFetch('/api/exposure/status');
  if (!res.ok) {
    throw new Error(`Failed to load exposure status (${res.status})`);
  }
  return (await res.json()) as ExposureStatusResponse;
}

export async function startTailscaleExposure(mode: 'serve' | 'funnel' = 'serve'): Promise<ExposureStatusResponse> {
  const res = await apiFetch('/api/exposure/tailscale/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Start failed (${res.status})`);
  }
  return (await res.json()) as ExposureStatusResponse;
}

export async function stopTailscaleExposure(): Promise<ExposureStatusResponse> {
  const res = await apiFetch('/api/exposure/tailscale/stop', { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Stop failed (${res.status})`);
  }
  return (await res.json()) as ExposureStatusResponse;
}
