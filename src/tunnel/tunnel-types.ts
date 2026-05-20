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
  config: {
    autoStart: boolean;
    brokerUrl: string;
  };
};

export type TunnelQrPayload = {
  qrPayload: string;
  publicUrl: string | null;
  lanUrl: string | null;
};
