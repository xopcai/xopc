export type TunnelTrayPayload = {
  enabled: boolean;
  state?: string;
};

export type TunnelTrayStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/** Map gateway /api/tunnel/status to tray label state (check `state` before `enabled`). */
export function mapTunnelTrayStatus(data: TunnelTrayPayload): TunnelTrayStatus {
  const state = data.state;
  if (state === 'connecting' || state === 'reconnecting') return 'connecting';
  if (state === 'error') return 'error';
  if (data.enabled && state === 'connected') return 'connected';
  if (data.enabled) return 'connecting';
  return 'disconnected';
}

export function pollIntervalForTunnelTrayStatus(status: TunnelTrayStatus): number {
  return status === 'connecting' ? 5_000 : 30_000;
}
