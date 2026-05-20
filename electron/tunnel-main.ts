import { powerMonitor } from 'electron';

import { updateTrayTunnelStatus } from './tray.js';

let embeddedGatewayPort: number | null = null;
let embeddedGatewayToken: string | null = null;
let tunnelPollTimer: ReturnType<typeof setInterval> | null = null;
let lastTunnelTrayStatus: 'connected' | 'disconnected' | 'connecting' | null = null;

export function setEmbeddedGatewayCredentials(port: number, token: string): void {
  embeddedGatewayPort = port;
  embeddedGatewayToken = token;
}

function authHeaders(): Record<string, string> {
  return embeddedGatewayToken
    ? { Authorization: `Bearer ${embeddedGatewayToken}` }
    : {};
}

async function fetchTunnelStatus(): Promise<{
  enabled: boolean;
  config?: { autoStart?: boolean };
} | null> {
  if (!embeddedGatewayPort || !embeddedGatewayToken) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${embeddedGatewayPort}/api/tunnel/status`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as { enabled: boolean; config?: { autoStart?: boolean } };
  } catch {
    return null;
  }
}

export async function maybeAutoStartTunnel(): Promise<void> {
  const status = await fetchTunnelStatus();
  if (!status?.config?.autoStart || status.enabled) return;
  if (!embeddedGatewayPort || !embeddedGatewayToken) return;
  try {
    await fetch(`http://127.0.0.1:${embeddedGatewayPort}/api/tunnel/start`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch (err) {
    console.error('[Electron] Auto-start tunnel failed:', err);
  }
}

function mapTrayStatus(data: { enabled: boolean; state?: string }): 'connected' | 'disconnected' | 'connecting' {
  if (data.enabled) return 'connected';
  if (data.state === 'connecting' || data.state === 'reconnecting') return 'connecting';
  return 'disconnected';
}

export function startTunnelStatusPolling(): void {
  stopTunnelStatusPolling();
  const poll = async () => {
    const data = await fetchTunnelStatus();
    if (!data) return;
    const next = mapTrayStatus(data as { enabled: boolean; state?: string });
    if (next !== lastTunnelTrayStatus) {
      lastTunnelTrayStatus = next;
      updateTrayTunnelStatus(next);
    }
  };
  void poll();
  tunnelPollTimer = setInterval(() => void poll(), 30_000);
}

export function stopTunnelStatusPolling(): void {
  if (tunnelPollTimer) {
    clearInterval(tunnelPollTimer);
    tunnelPollTimer = null;
  }
}

export function registerTunnelPowerMonitor(): void {
  powerMonitor.on('resume', () => {
    if (!embeddedGatewayPort || !embeddedGatewayToken) return;
    void fetch(`http://127.0.0.1:${embeddedGatewayPort}/api/tunnel/status`, {
      headers: authHeaders(),
    }).catch(() => {
      /* gateway may still be waking; TunnelService will reconnect */
    });
  });
}
