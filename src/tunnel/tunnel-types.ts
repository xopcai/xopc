export type FrpcDownloadProgress = {
  phase: 'downloading' | 'extracting';
  bytesReceived?: number;
  totalBytes?: number | null;
  percent?: number | null;
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
  config: {
    autoStart: boolean;
    brokerUrl: string;
    e2e: {
      enabled: boolean;
      tlsPort: number;
      staging: boolean;
    };
  };
  cert: {
    status: 'no_cert' | 'healthy' | 'expiring_soon' | 'critical' | 'renewal_failed';
    domain: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    daysUntilExpiry: number | null;
    autoRenewal: boolean;
    renewalFailed: boolean;
    lastRenewalError: string | null;
    lastRenewalErrorAt: string | null;
  };
};

export type TunnelQrPayload = {
  qrPayload: string;
  publicUrl: string | null;
  lanUrl: string | null;
  expiresAt?: string;
};
