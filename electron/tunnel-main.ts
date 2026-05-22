import { powerMonitor } from 'electron';

import {
  mapTunnelTrayStatus,
  pollIntervalForTunnelTrayStatus,
  type TunnelTrayStatus,
} from './tunnel-tray-status.js';
import { updateTrayTunnelStatus } from './tray.js';

let embeddedGatewayPort: number | null = null;
let embeddedGatewayToken: string | null = null;
let tunnelPollTimer: ReturnType<typeof setInterval> | null = null;
let lastTunnelTrayStatus: TunnelTrayStatus | null = null;
let tunnelPollIntervalMs = 30_000;

export function setEmbeddedGatewayCredentials(port: number, token: string): void {
  embeddedGatewayPort = port;
  embeddedGatewayToken = token;
}

function authHeaders(): Record<string, string> {
  return embeddedGatewayToken
    ? { Authorization: `Bearer ${embeddedGatewayToken}` }
    : {};
}

type TunnelStatusPayload = {
  enabled: boolean;
  state?: string;
  consentRequired?: boolean;
  canAutoStart?: boolean;
  config?: { autoStart?: boolean };
};

async function fetchTunnelStatus(): Promise<TunnelStatusPayload | null> {
  if (!embeddedGatewayPort || !embeddedGatewayToken) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${embeddedGatewayPort}/api/tunnel/status`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as TunnelStatusPayload;
  } catch {
    return null;
  }
}

function isTunnelAlreadyActive(status: TunnelStatusPayload): boolean {
  const state = status.state;
  return (
    state === 'connected' ||
    state === 'connecting' ||
    state === 'reconnecting' ||
    status.enabled
  );
}

export async function maybeAutoStartTunnel(): Promise<void> {
  const status = await fetchTunnelStatus();
  if (!status?.config?.autoStart) return;
  if (status.consentRequired) return;
  if (!status.canAutoStart) return;
  if (isTunnelAlreadyActive(status)) return;
  if (!embeddedGatewayPort || !embeddedGatewayToken) return;
  try {
    const res = await fetch(`http://127.0.0.1:${embeddedGatewayPort}/api/tunnel/start`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      console.error('[Electron] Auto-start tunnel failed:', body.error ?? res.status);
    }
  } catch (err) {
    console.error('[Electron] Auto-start tunnel failed:', err);
  }
}

function scheduleTunnelPoll(runImmediately: boolean): void {
  if (tunnelPollTimer) {
    clearInterval(tunnelPollTimer);
    tunnelPollTimer = null;
  }
  const poll = async () => {
    const data = await fetchTunnelStatus();
    if (!data) return;
    const next = mapTunnelTrayStatus(data);
    if (next !== lastTunnelTrayStatus) {
      lastTunnelTrayStatus = next;
      updateTrayTunnelStatus(next);
    }
    const desiredInterval = pollIntervalForTunnelTrayStatus(next);
    if (desiredInterval !== tunnelPollIntervalMs) {
      tunnelPollIntervalMs = desiredInterval;
      scheduleTunnelPoll(false);
      return;
    }
  };
  if (runImmediately) void poll();
  tunnelPollTimer = setInterval(() => void poll(), tunnelPollIntervalMs);
}

export function startTunnelStatusPolling(): void {
  stopTunnelStatusPolling();
  tunnelPollIntervalMs = 30_000;
  lastTunnelTrayStatus = null;
  scheduleTunnelPoll(true);
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
