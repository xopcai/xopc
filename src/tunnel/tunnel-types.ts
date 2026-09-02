export type FrpcDownloadProgress = {
  phase: 'downloading' | 'extracting';
  url?: string;
  bytesReceived?: number;
  totalBytes?: number | null;
  percent?: number | null;
};

export type TunnelStartPhase =
  | 'preparing_frpc'
  | 'registering'
  | 'starting_frpc'
  | 'reconnecting_frpc';

export type TunnelStartProgress = {
  phase: TunnelStartPhase;
  startedAt: string;
  publicUrl?: string | null;
};

export type TunnelRegistration = {
  tunnelId: string;
  tunnelToken: string;
  subdomain: string;
  publicUrl: string;
  frpc: {
    serverAddr: string;
    serverPort: number;
    authToken: string;
    proxyName: string;
  };
  expiresAt: string;
  heartbeatIntervalMs: number;
};

export type PersistedTunnelState = {
  tunnelId: string;
  tunnelToken: string;
  subdomain: string;
  publicUrl: string;
  frpcAuthToken: string;
  registeredAt: string;
  enabled?: boolean;
  /** Saved on register so stop/start can resume without re-registering. */
  frpcServerAddr?: string;
  frpcServerPort?: number;
  proxyName?: string;
  heartbeatIntervalMs?: number;
};

export type TunnelStatus = {
  enabled: boolean;
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  subdomain: string | null;
  publicUrl: string | null;
  connectedSince: string | null;
  frpcPid: number | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  frpcDownload?: FrpcDownloadProgress | null;
  startProgress?: TunnelStartProgress | null;
  config: {
    autoStart: boolean;
    brokerUrl: string;
    transport: {
      tls: 'broker_terminated';
    };
  };
};
