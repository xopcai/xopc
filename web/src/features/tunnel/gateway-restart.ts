import { fetchJson } from '@/lib/fetch';
import { isElectron } from '@/lib/electron-env';
import { apiUrl } from '@/lib/url';
import { fetchTunnelPairContext, type MobilePairContextResponse } from '@/features/tunnel/tunnel-api';

export async function restartGatewayAfterConfigChange(): Promise<{ ok: boolean; message?: string }> {
  if (isElectron() && window.electronAPI?.gateway?.restart) {
    return window.electronAPI.gateway.restart();
  }

  const res = await fetchJson<{ ok?: boolean; message?: string; error?: string }>(
    apiUrl('/api/gateway/restart'),
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (res.ok === false) {
    return { ok: false, message: res.message ?? res.error ?? 'Gateway restart failed' };
  }
  return { ok: true };
}

export async function waitForGatewayApiReady(
  token: string,
  params: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = params.timeoutMs ?? 90_000;
  const intervalMs = params.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(apiUrl('/api/tunnel/pair/context'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function waitForPairingReadyAfterRestart(
  params: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<MobilePairContextResponse | null> {
  const timeoutMs = params.timeoutMs ?? 90_000;
  const intervalMs = params.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const context = await fetchTunnelPairContext();
      if (context.pairingReady) return context;
    } catch {
      /* retry until gateway is back */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
